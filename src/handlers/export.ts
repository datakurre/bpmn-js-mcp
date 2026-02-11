/**
 * Unified handler for export_bpmn tool (XML and SVG).
 *
 * Merges the former export_bpmn_xml, export_bpmn_svg, and
 * export_bpmn_subprocess tools into a single tool with a required
 * `format` parameter and an optional `elementId` for scoping to a
 * subprocess or participant.
 *
 * Implicit lint: by default, export runs bpmnlint and appends error-level
 * issues to the response.  Set `skipLint: true` to bypass.
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  buildConnectivityWarnings,
  validateArgs,
  getVisibleElements,
} from './helpers';
import { lintDiagramFlat } from '../linter';
import { handleScopedExport } from './export-scoped';

export interface ExportBpmnArgs {
  diagramId: string;
  format: 'xml' | 'svg' | 'both';
  skipLint?: boolean;
  lintMinSeverity?: 'error' | 'warning';
  elementId?: string;
  filePath?: string;
}

/** Run lint and return blocking issues, or empty array on skip/failure. */
async function checkLintGate(
  diagram: any,
  skipLint: boolean,
  lintMinSeverity: string
): Promise<{ blocked: boolean; content?: ToolResult['content']; skipLintWarning?: string }> {
  if (skipLint) {
    try {
      const issues = await lintDiagramFlat(diagram);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        const summary = errors
          .slice(0, 5)
          .map((i) => `[${i.rule}]${i.elementId ? ` ${i.elementId}` : ''}`)
          .join(', ');
        const suffix = errors.length > 5 ? `, ... (${errors.length} total)` : '';
        return {
          blocked: false,
          skipLintWarning:
            `⚠️ skipLint bypassed ${errors.length} error(s): ${summary}${suffix}. ` +
            'The exported diagram may have structural issues. ' +
            'Run validate_bpmn_diagram to review all issues.',
        };
      }
    } catch {
      // Lint failure is non-fatal when skipping
    }
    return { blocked: false };
  }

  try {
    const issues = await lintDiagramFlat(diagram);
    const blocking = issues.filter((i) =>
      lintMinSeverity === 'warning'
        ? i.severity === 'error' || i.severity === 'warning'
        : i.severity === 'error'
    );
    if (blocking.length > 0) {
      const lines = blocking.map(
        (i) => `- [${i.rule}] ${i.message}${i.elementId ? ` (${i.elementId})` : ''}`
      );
      return {
        blocked: true,
        content: [
          {
            type: 'text',
            text: [
              `Export blocked: ${blocking.length} lint issue(s) at '${lintMinSeverity}' severity or above must be resolved first.`,
              'Fix the issues below or re-export with skipLint: true.',
              '',
              ...lines,
            ].join('\n'),
          },
        ],
      };
    }
  } catch {
    // Linting failure should not block export
  }
  return { blocked: false };
}

/** Padding (px) around diagram content in exported SVG. */
const SVG_PADDING = 5;

/**
 * Adjust the SVG viewBox to tightly fit the diagram content with
 * consistent padding.  Computes the bounding box from the element
 * registry (all shapes + labels + connection waypoints) and sets
 * the viewBox to `(minX-pad, minY-pad, width+2*pad, height+2*pad)`.
 *
 * This matches the reference convention where SVG viewBoxes preserve
 * the BPMN DI coordinate space with 5px padding on all sides.
 */
function adjustSvgViewBox(svg: string, diagram: any): string {
  if (!svg) return svg;

  try {
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const allElements = getVisibleElements(elementRegistry);
    const bounds = computeDiagramBounds(allElements);

    if (!bounds) return svg;

    const vbX = Math.round(bounds.minX - SVG_PADDING);
    const vbY = Math.round(bounds.minY - SVG_PADDING);
    const vbW = Math.round(bounds.maxX - bounds.minX + 2 * SVG_PADDING);
    const vbH = Math.round(bounds.maxY - bounds.minY + 2 * SVG_PADDING);

    return svg.replace(/viewBox="[^"]*"/, `viewBox="${vbX} ${vbY} ${vbW} ${vbH}"`);
  } catch {
    return svg;
  }
}

/** Compute the tight bounding box of all diagram elements, labels, and waypoints. */
function computeDiagramBounds(
  elements: any[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const el of elements) {
    expandBoundsForShape(el);
    expandBoundsForLabel(el);
    expandBoundsForWaypoints(el);
  }

  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };

  function expandBoundsForShape(el: any): void {
    if (el.x === undefined || el.y === undefined) return;
    update(el.x, el.y, el.x + (el.width || 0), el.y + (el.height || 0));
  }

  function expandBoundsForLabel(el: any): void {
    if (!el.label || el.label.x === undefined || el.label.y === undefined) return;
    const lx = el.label.x,
      ly = el.label.y;
    update(lx, ly, lx + (el.label.width || 90), ly + (el.label.height || 20));
  }

  function expandBoundsForWaypoints(el: any): void {
    if (!el.waypoints) return;
    for (const wp of el.waypoints) {
      update(wp.x, wp.y, wp.x, wp.y);
    }
  }

  function update(x1: number, y1: number, x2: number, y2: number): void {
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  }
}

/** Perform the actual XML/SVG export from the modeler. */
async function performExport(diagram: any, format: string): Promise<ToolResult['content']> {
  const content: ToolResult['content'] = [];

  if (format === 'both') {
    const { xml } = await diagram.modeler.saveXML({ format: true });
    const xmlOutput = xml || '';
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
    const { xml } = await diagram.modeler.saveXML({ format: true });
    const xmlOutput = xml || '';
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
  fs.writeFileSync(filePath, content[0].text, 'utf-8');
}

export async function handleExportBpmn(args: ExportBpmnArgs): Promise<ToolResult> {
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

  // Scoped export (subprocess / participant)
  if (elementId) return handleScopedExport(diagram, elementId, format);

  // Lint gate check
  const lintCheck = await checkLintGate(diagram, skipLint, lintMinSeverity);
  if (lintCheck.blocked) return { content: lintCheck.content! };

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

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const warnings = buildConnectivityWarnings(elementRegistry);
  warnings.push(...buildLayoutWarnings(elementRegistry));
  if (warnings.length > 0) {
    content.push({ type: 'text', text: '\n' + warnings.join('\n') });
  }

  return { content };
}

// ── Layout quality warnings ──────────────────────────────────────────────

/**
 * Validate that exported XML is well-formed by checking structure markers.
 * Throws if the XML appears corrupted (e.g. from terminal heredoc corruption).
 */
function validateXmlOutput(xml: string): void {
  if (!xml || xml.length === 0) {
    throw new McpError(ErrorCode.InternalError, 'Export produced empty XML output');
  }
  if (!xml.includes('</bpmn:definitions>') && !xml.includes('</definitions>')) {
    throw new McpError(
      ErrorCode.InternalError,
      'Export produced malformed XML: missing closing </bpmn:definitions> tag'
    );
  }
}

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
    'Export a BPMN diagram as XML or SVG. By default, runs bpmnlint and blocks export if there are error-level lint issues. Set skipLint to true to bypass validation. Optionally scope to a subprocess or participant via elementId. ' +
    "Use format 'both' to get XML and SVG in a single call. " +
    'Use filePath to write the exported content directly to a file.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      format: {
        type: 'string',
        enum: ['xml', 'svg', 'both'],
        description:
          "The export format: 'xml' for BPMN XML, 'svg' for SVG image, 'both' for XML and SVG in one call",
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
          'Optional ID of a SubProcess or Participant to export as a standalone diagram. When provided, lint gating is skipped.',
      },
      filePath: {
        type: 'string',
        description:
          "Optional file path to write the exported content to. For 'both' format, writes the XML portion. Directories are created automatically.",
      },
    },
    required: ['diagramId', 'format'],
  },
} as const;
