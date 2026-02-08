/**
 * Unified handler for export_bpmn tool (XML and SVG).
 *
 * Merges the former export_bpmn_xml and export_bpmn_svg tools into a
 * single tool with a required `format` parameter.
 *
 * Implicit lint: by default, export runs bpmnlint and appends error-level
 * issues to the response.  Set `skipLint: true` to bypass.
 */

import { type ToolResult } from '../types';
import { requireDiagram, buildConnectivityWarnings, validateArgs } from './helpers';
import { lintDiagramFlat } from '../linter';

export interface ExportBpmnArgs {
  diagramId: string;
  format: 'xml' | 'svg';
  skipLint?: boolean;
  lintMinSeverity?: 'error' | 'warning';
}

export async function handleExportBpmn(args: ExportBpmnArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'format']);
  const { diagramId, format, skipLint = false, lintMinSeverity = 'error' } = args;
  const diagram = requireDiagram(diagramId);

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

  const content: ToolResult['content'] = [{ type: 'text', text: output }];
  if (warnings.length > 0) {
    content.push({ type: 'text', text: '\n' + warnings.join('\n') });
  }
  return { content };
}

export const TOOL_DEFINITION = {
  name: 'export_bpmn',
  description:
    'Export a BPMN diagram as XML or SVG. By default, runs bpmnlint and blocks export if there are error-level lint issues. Set skipLint to true to bypass validation.',
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
    },
    required: ['diagramId', 'format'],
  },
} as const;
