/**
 * Unified handler for export_bpmn tool (XML, SVG, PNG, animated, HTML).
 *
 * Merges the former export_bpmn_xml, export_bpmn_svg, and
 * export_bpmn_subprocess tools into a single tool with a required
 * `format` parameter and an optional `elementId` for scoping to a
 * subprocess or participant (xml/svg/both only).
 *
 * Implicit lint: by default, export runs bpmnlint and appends error-level
 * issues to the response.  Set `skipLint: true` to bypass.
 */
// @readonly

import { type ToolResult, type ToolContext } from '../../types';
import { exportFailedError } from '../../errors';
import {
  requireDiagram,
  buildConnectivityWarnings,
  buildConnectivityNextSteps,
  validateArgs,
  getVisibleElements,
  getService,
} from '../helpers';
import { handleScopedExport } from './export-scoped';
import {
  normalizePlaneElementOrder,
  checkLintGate,
  deduplicateDiElements,
  validateXmlOutput,
  adjustSvgViewBox,
} from './export-helpers';
import { isMediaFormat, handleMediaExport, type MediaFormat } from './export-media';

export interface ExportBpmnArgs {
  diagramId: string;
  format: 'xml' | 'svg' | 'both' | MediaFormat;
  skipLint?: boolean;
  lintMinSeverity?: 'error' | 'warning';
  elementId?: string;
  filePath?: string;
  /** PNG/animated formats: pixel density multiplier. Default: 2 for PNG, 1 for animations. */
  scale?: number;
  /** PNG/animated/HTML formats: background color (CSS color string). Default: transparent. */
  background?: string;
  /** Animated formats (gif/apng/mp4/webp): TOML scenario steering token-simulation. Omit for the diagram's default scenario. */
  scenario?: string;
  /** Animated formats: frames per second. */
  fps?: number;
  /** gif format only: encoder to use. Default: 'auto' (ffmpeg when on PATH, else bundled gifenc). */
  encoder?: 'auto' | 'gifenc' | 'ffmpeg';
}

/** Perform the actual XML/SVG export from the modeler. */
async function performExport(diagram: any, format: string): Promise<ToolResult['content']> {
  const content: ToolResult['content'] = [];

  if (format === 'both') {
    const { xml: rawXml } = await diagram.modeler.saveXML({ format: true });
    const xmlOutput = deduplicateDiElements(normalizePlaneElementOrder(rawXml || ''));
    validateXmlOutput(xmlOutput);
    const { svg } = await diagram.modeler.saveSVG();
    const adjustedSvg = adjustSvgViewBox(svg || '', diagram);
    content.push({ type: 'text', text: xmlOutput });
    content.push({ type: 'text', text: adjustedSvg });
  } else if (format === 'svg') {
    const { svg } = await diagram.modeler.saveSVG();
    const adjustedSvg = adjustSvgViewBox(svg || '', diagram);
    content.push({ type: 'text', text: adjustedSvg });
  } else {
    const { xml: rawXml } = await diagram.modeler.saveXML({ format: true });
    const xmlOutput = deduplicateDiElements(normalizePlaneElementOrder(rawXml || ''));
    validateXmlOutput(xmlOutput);
    content.push({ type: 'text', text: xmlOutput });
  }

  return content;
}

/** Write primary export content to a file. */
async function writeExportToFile(filePath: string, content: ToolResult['content']): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content[0].text!, 'utf-8');
}

export async function handleExportBpmn(
  args: ExportBpmnArgs,
  context?: ToolContext
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'format']);
  const {
    diagramId,
    format,
    skipLint = false,
    lintMinSeverity = 'error',
    elementId,
    filePath,
  } = args;
  const diagram = requireDiagram(diagramId);

  if (isMediaFormat(format)) {
    if (!filePath) {
      throw exportFailedError(
        `format '${format}' produces binary/large output and must be written to a file — pass filePath.`
      );
    }
    if (elementId) {
      throw exportFailedError(
        `format '${format}' is not supported together with elementId (subprocess/participant scoped export). Export the full diagram instead.`
      );
    }
    return handleMediaExport(diagram, format, args, filePath, context);
  }

  // Scoped export (subprocess / participant)
  if (elementId) return handleScopedExport(diagram, elementId, format);

  await context?.sendProgress?.(0, 100, 'Validating diagram…');

  // Lint gate check
  const lintCheck = await checkLintGate(diagram, skipLint, lintMinSeverity);
  if (lintCheck.blocked) return { content: lintCheck.content! };

  await context?.sendProgress?.(50, 100, 'Exporting diagram…');

  // Perform export
  const content = await performExport(diagram, format);

  // Write to file if requested
  if (filePath) {
    await writeExportToFile(filePath, content);
    content.push({ type: 'text', text: `\n✅ Written to ${filePath}` });
  }

  // Append warnings
  if (lintCheck.skipLintWarning) {
    content.push({ type: 'text', text: '\n' + lintCheck.skipLintWarning });
  }

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const warnings = buildConnectivityWarnings(elementRegistry);
  warnings.push(...buildLayoutWarnings(elementRegistry));
  if (warnings.length > 0) {
    content.push({ type: 'text', text: '\n' + warnings.join('\n') });
    // Also emit structured nextSteps for disconnected elements so AI agents
    // can act on them without further parsing.
    const nextSteps = buildConnectivityNextSteps(elementRegistry, diagramId);
    if (nextSteps.length > 0) {
      content.push({
        type: 'text',
        text:
          '\n**nextSteps** (connect disconnected elements):\n' + JSON.stringify(nextSteps, null, 2),
      });
    }
  }

  return { content };
}

// ── Layout quality warnings ──────────────────────────────────────────────

/**
 * Detect layout issues (overlapping elements, missing layout) and return
 * actionable warnings suggesting layout_bpmn_diagram or move_bpmn_element.
 */
function buildLayoutWarnings(elementRegistry: any): string[] {
  const elements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane'
  );

  if (elements.length < 2) return [];

  const warnings: string[] = [];
  const overlappingPairs = detectOverlappingPairs(elements);

  if (overlappingPairs.length > 0) {
    const pairDetails = overlappingPairs
      .slice(0, 5)
      .map(([a, b]) => `${a} ↔ ${b}`)
      .join(', ');
    const suffix = overlappingPairs.length > 5 ? ` (showing 5 of ${overlappingPairs.length})` : '';
    warnings.push(
      `⚠️ Layout: ${overlappingPairs.length} overlapping element pair(s) detected: ${pairDetails}${suffix}. ` +
        'Consider running layout_bpmn_diagram to auto-arrange elements, ' +
        'or use move_bpmn_element to manually reposition.'
    );
  }

  // Check if all elements share the same position (no layout applied)
  const uniquePositions = new Set(elements.map((el: any) => `${el.x},${el.y}`));
  if (elements.length > 2 && uniquePositions.size === 1) {
    warnings.push(
      `⚠️ Layout: All ${elements.length} elements appear to be at the same position. ` +
        'Run layout_bpmn_diagram to apply automatic layout.'
    );
  }

  return warnings;
}

/** Find pairs of overlapping elements via pairwise bounding-box intersection. */
function detectOverlappingPairs(elements: any[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];
      if (a.parent === b || b.parent === a) continue;
      if (boundsOverlap(a, b)) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

/** Check if two element bounding boxes overlap. */
function boundsOverlap(a: any, b: any): boolean {
  const ax = a.x ?? 0,
    ay = a.y ?? 0,
    aw = a.width ?? 0,
    ah = a.height ?? 0;
  const bx = b.x ?? 0,
    by = b.y ?? 0,
    bw = b.width ?? 0,
    bh = b.height ?? 0;
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export const TOOL_DEFINITION = {
  name: 'export_bpmn',
  description:
    'Export a BPMN diagram as XML, SVG, PNG, an animated GIF/APNG/MP4/WebP, or a standalone interactive HTML embed, and write it to a file. By default, runs bpmnlint and blocks export if there are error-level lint issues. Set skipLint to true to bypass validation. Optionally scope to a subprocess or participant via elementId (xml/svg/both only). ' +
    "Use format 'both' to get XML and SVG in a single call. " +
    'PNG/animated/HTML formats always write to filePath (required for those formats) rather than inlining. ' +
    "Animated formats render token-simulation driven by an optional TOML scenario (see the executable-Camunda-7 guide resource); omit scenario to use the diagram's own default. " +
    'gif/apng/mp4/webp/html require optional dependencies (gifenc or ffmpeg for encoding, smol-toml for scenario parsing) — errors name the missing one. ' +
    'The exported text content is also returned in the response (binary/HTML formats return a confirmation only).',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      format: {
        type: 'string',
        enum: ['xml', 'svg', 'both', 'png', 'gif', 'apng', 'mp4', 'webp', 'html'],
        description:
          "The export format: 'xml' for BPMN XML, 'svg' for SVG image, 'both' for XML and SVG in one call, " +
          "'png' for a static image, 'gif'/'apng'/'mp4'/'webp' for an animated token-simulation, " +
          "'html' for a standalone interactive embed.",
      },
      filePath: {
        type: 'string',
        description:
          "File path to write the exported content to. For 'both' format, writes the XML portion. Required for png/gif/apng/mp4/webp/html. Directories are created automatically.",
      },
      skipLint: {
        type: 'boolean',
        description:
          'Skip lint validation before export. Default: false (lint errors block export).',
      },
      lintMinSeverity: {
        type: 'string',
        enum: ['error', 'warning'],
        description:
          "Minimum lint severity that blocks export. 'error' (default) blocks only on errors. 'warning' blocks on warnings too. Useful for strict CI pipelines.",
      },
      elementId: {
        type: 'string',
        description:
          'Optional ID of a SubProcess or Participant to export as a standalone diagram (xml/svg/both only). When provided, lint gating is skipped.',
      },
      scale: {
        type: 'number',
        description:
          'png/animated formats: pixel density multiplier. Default: 2 for png, 1 for animations.',
      },
      background: {
        type: 'string',
        description:
          'png/animated/html formats: background color (CSS color string, e.g. "white"). Default: transparent.',
      },
      scenario: {
        type: 'string',
        description:
          "gif/apng/mp4/webp only: TOML scenario steering token-simulation (which gateway branches/events fire, and when). Omit to render the diagram's own default scenario.",
      },
      fps: {
        type: 'number',
        description: 'gif/apng/mp4/webp only: rendered animation frame rate.',
      },
      encoder: {
        type: 'string',
        enum: ['auto', 'gifenc', 'ffmpeg'],
        description:
          "gif format only: 'auto' (default) prefers ffmpeg when on PATH for better quality, else the bundled gifenc.",
      },
    },
    required: ['diagramId', 'format', 'filePath'],
  },
} as const;
