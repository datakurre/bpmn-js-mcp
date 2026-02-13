/**
 * Handler for adjust_labels tool.
 *
 * Exposes label adjustment as an explicit MCP tool.
 */

import { type ToolResult } from '../../../types';
import { validateArgs, requireDiagram, jsonResult } from '../../helpers';
import { adjustDiagramLabels, adjustFlowLabels } from './adjust-labels';

export interface AdjustLabelsArgs {
  diagramId: string;
}

export async function handleAdjustLabels(args: AdjustLabelsArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const diagram = requireDiagram(args.diagramId);

  const elementLabelsMoved = await adjustDiagramLabels(diagram);
  const flowLabelsMoved = await adjustFlowLabels(diagram);
  const totalMoved = elementLabelsMoved + flowLabelsMoved;

  return jsonResult({
    success: true,
    elementLabelsMoved,
    flowLabelsMoved,
    totalMoved,
    message:
      totalMoved > 0
        ? `Adjusted ${totalMoved} label(s) to reduce overlap (${elementLabelsMoved} element, ${flowLabelsMoved} flow)`
        : 'No label adjustments needed — all labels are well-positioned',
  });
}

export const TOOL_DEFINITION = {
  name: 'adjust_bpmn_labels',
  description:
    'Adjust external labels on elements and connections to reduce overlap with sequence flows and other labels. Useful after importing diagrams or manual positioning.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
    },
    required: ['diagramId'],
  },
} as const;
