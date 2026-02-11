/**
 * Handler for bpmn_history tool.
 *
 * Merges the former undo_bpmn_change and redo_bpmn_change tools into a
 * single tool with `action: "undo" | "redo"` and optional `steps` param.
 */

import { type ToolResult } from '../types';
import { requireDiagram, jsonResult, syncXml, validateArgs, getService } from './helpers';

export interface BpmnHistoryArgs {
  diagramId: string;
  action: 'undo' | 'redo';
  steps?: number;
}

export async function handleBpmnHistory(args: BpmnHistoryArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'action']);
  const { diagramId, action, steps = 1 } = args;
  const diagram = requireDiagram(diagramId);

  const commandStack = getService(diagram.modeler, 'commandStack');
  const isUndo = action === 'undo';
  const canDo = isUndo ? () => commandStack.canUndo() : () => commandStack.canRedo();
  const doAction = isUndo ? () => commandStack.undo() : () => commandStack.redo();
  const nothingMsg = isUndo
    ? 'Nothing to undo — command stack is empty'
    : 'Nothing to redo — no undone changes available';
  const doneVerb = isUndo ? 'Undid' : 'Redid';

  if (!canDo()) {
    return jsonResult({
      success: false,
      message: nothingMsg,
    });
  }

  let performed = 0;
  for (let i = 0; i < steps; i++) {
    if (!canDo()) break;
    doAction();
    performed++;
  }

  await syncXml(diagram);

  return jsonResult({
    success: true,
    canUndo: commandStack.canUndo(),
    canRedo: commandStack.canRedo(),
    stepsPerformed: performed,
    message: `${doneVerb} ${performed} change(s)`,
  });
}

// Backward-compatible aliases
export async function handleUndoChange(args: { diagramId: string }): Promise<ToolResult> {
  return handleBpmnHistory({ ...args, action: 'undo' });
}

export async function handleRedoChange(args: { diagramId: string }): Promise<ToolResult> {
  return handleBpmnHistory({ ...args, action: 'redo' });
}

export const TOOL_DEFINITION = {
  name: 'bpmn_history',
  description:
    'Undo or redo changes on a BPMN diagram. Uses the bpmn-js command stack to reverse or re-apply operations. Supports multiple steps.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      action: {
        type: 'string',
        enum: ['undo', 'redo'],
        description: "The history action to perform: 'undo' to reverse, 'redo' to re-apply.",
      },
      steps: {
        type: 'number',
        description: 'Number of steps to undo/redo (default: 1).',
      },
    },
    required: ['diagramId', 'action'],
  },
} as const;
