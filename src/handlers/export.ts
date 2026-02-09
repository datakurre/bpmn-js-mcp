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
import {
  requireDiagram,
  requireElement,
  buildConnectivityWarnings,
  validateArgs,
  getVisibleElements,
} from './helpers';
import { lintDiagramFlat } from '../linter';
import { createModelerFromXml } from '../diagram-manager';

export interface ExportBpmnArgs {
  diagramId: string;
  format: 'xml' | 'svg';
  skipLint?: boolean;
  lintMinSeverity?: 'error' | 'warning';
  elementId?: string;
}

export async function handleExportBpmn(args: ExportBpmnArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'format']);
  const { diagramId, format, skipLint = false, lintMinSeverity = 'error', elementId } = args;
  const diagram = requireDiagram(diagramId);

  // ── Scoped export (subprocess / participant) ──────────────────────────
  if (elementId) {
    return handleScopedExport(diagram, elementId, format);
  }

  // ── Implicit lint (unless explicitly skipped) ─────────────────────────
  if (!skipLint) {
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
  }

  // ── Export ────────────────────────────────────────────────────────────
  let output: string;
  if (format === 'svg') {
    const { svg } = await diagram.modeler.saveSVG();
    output = svg || '';
  } else {
    const { xml } = await diagram.modeler.saveXML({ format: true });
    output = xml || '';
  }

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const warnings = buildConnectivityWarnings(elementRegistry);
  const layoutWarnings = buildLayoutWarnings(elementRegistry);
  warnings.push(...layoutWarnings);

  const content: ToolResult['content'] = [{ type: 'text', text: output }];
  if (warnings.length > 0) {
    content.push({ type: 'text', text: '\n' + warnings.join('\n') });
  }
  return { content };
}

// ── Layout quality warnings ──────────────────────────────────────────────

/**
 * Detect layout issues (overlapping elements, missing layout) and return
 * actionable warnings suggesting layout_bpmn_diagram or move_bpmn_element.
 */
function buildLayoutWarnings(elementRegistry: any): string[] {
  const warnings: string[] = [];

  // Get all visible non-flow, non-container elements
  const elements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane'
  );

  if (elements.length < 2) return warnings;

  // Check for overlapping elements (pairwise bounding-box intersection)
  const overlappingPairs: Array<[string, string]> = [];
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];

      // Skip parent-child pairs (e.g. elements inside a subprocess)
      if (a.parent === b || b.parent === a) continue;

      const ax = a.x ?? 0;
      const ay = a.y ?? 0;
      const aw = a.width ?? 0;
      const ah = a.height ?? 0;
      const bx = b.x ?? 0;
      const by = b.y ?? 0;
      const bw = b.width ?? 0;
      const bh = b.height ?? 0;

      if (ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by) {
        overlappingPairs.push([a.id, b.id]);
      }
    }
  }

  if (overlappingPairs.length > 0) {
    const pairDetails = overlappingPairs
      .slice(0, 5) // Limit detail output for readability
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

// ── Scoped export (subprocess / participant) ─────────────────────────────

async function handleScopedExport(
  diagram: any,
  elementId: string,
  format: string
): Promise<ToolResult> {
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const element = requireElement(elementRegistry, elementId);

  const elType = element.type || element.businessObject?.$type || '';
  if (!elType.includes('SubProcess') && !elType.includes('Participant')) {
    return {
      content: [
        {
          type: 'text',
          text: `Element ${elementId} is not a SubProcess or Participant (type: ${elType}). Only these types can be exported as standalone diagrams.`,
        },
      ],
    };
  }

  const bo = element.businessObject;
  const moddle = diagram.modeler.get('moddle');

  let processBO: any;
  if (elType.includes('Participant')) {
    processBO = bo.processRef;
  } else {
    processBO = bo;
  }

  if (!processBO) {
    return {
      content: [
        {
          type: 'text',
          text: `Could not extract process from element ${elementId}.`,
        },
      ],
    };
  }

  const flowElements = processBO.flowElements || [];
  if (flowElements.length === 0 && !elType.includes('Participant')) {
    return {
      content: [
        {
          type: 'text',
          text: `SubProcess ${elementId} has no flow elements to export.`,
        },
      ],
    };
  }

  const { xml: fullXml } = await diagram.modeler.saveXML({ format: true });

  return exportSubprocessContent({
    moddle,
    processBO,
    elementId,
    format,
    fullXml: fullXml || '',
  });
}

async function exportSubprocessContent(opts: {
  moddle: any;
  processBO: any;
  elementId: string;
  format: string;
  fullXml: string;
}): Promise<ToolResult> {
  const { moddle, processBO, elementId, format, fullXml } = opts;
  try {
    const newProcess = moddle.create('bpmn:Process', {
      id: `Process_${elementId}`,
      isExecutable: true,
      flowElements: [...(processBO.flowElements || [])],
    });

    const exportDefs = moddle.create('bpmn:Definitions', {
      id: 'Definitions_export',
      targetNamespace: 'http://bpmn.io/schema/bpmn',
      rootElements: [newProcess],
    });
    newProcess.$parent = exportDefs;

    const { xml: exportXml } = await moddle.toXML(exportDefs, { format: true });

    if (format === 'svg') {
      try {
        const tempModeler = await createModelerFromXml(exportXml);
        const { svg } = await tempModeler.saveSVG();
        return { content: [{ type: 'text', text: svg || '' }] };
      } catch {
        return {
          content: [
            { type: 'text', text: exportXml },
            { type: 'text', text: '\n⚠ SVG export of subprocess failed; returning XML instead.' },
          ],
        };
      }
    }

    return { content: [{ type: 'text', text: exportXml }] };
  } catch {
    return {
      content: [
        { type: 'text', text: fullXml },
        {
          type: 'text',
          text: `\n⚠ Partial export fallback: full diagram XML returned for ${elementId}.`,
        },
      ],
    };
  }
}

export const TOOL_DEFINITION = {
  name: 'export_bpmn',
  description:
    'Export a BPMN diagram as XML or SVG. By default, runs bpmnlint and blocks export if there are error-level lint issues. Set skipLint to true to bypass validation. Optionally scope to a subprocess or participant via elementId.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      format: {
        type: 'string',
        enum: ['xml', 'svg'],
        description: "The export format: 'xml' for BPMN XML, 'svg' for SVG image",
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
    },
    required: ['diagramId', 'format'],
  },
} as const;
