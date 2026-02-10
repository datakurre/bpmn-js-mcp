/**
 * Handler for batch_bpmn_operations tool.
 *
 * Accepts an array of operations and executes them sequentially,
 * reducing round-trips for complex diagram construction.
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { validateArgs, jsonResult, syncXml } from './helpers';
import { dispatchToolCall } from './index';
import { setBatchMode, appendLintFeedback } from '../linter';
import { getDiagram } from '../diagram-manager';

export interface BatchOperationsArgs {
  operations: Array<{
    tool: string;
    args: Record<string, any>;
  }>;
  stopOnError?: boolean;
}

/** Capture command-stack positions for all referenced diagrams (for rollback). */
function captureCommandStackPositions(
  operations: BatchOperationsArgs['operations']
): Map<string, number> {
  const positions = new Map<string, number>();
  for (const op of operations) {
    const id = op.args?.diagramId;
    if (id && !positions.has(id)) {
      const diagram = getDiagram(id);
      if (diagram) {
        const commandStack = diagram.modeler.get('commandStack');
        positions.set(id, commandStack._stackIdx ?? 0);
      }
    }
  }
  return positions;
}

/** Rollback all diagrams to their pre-batch command-stack positions. */
async function rollbackDiagrams(positions: Map<string, number>): Promise<void> {
  for (const [id, startIdx] of positions) {
    const diagram = getDiagram(id);
    if (!diagram) continue;
    const commandStack = diagram.modeler.get('commandStack');
    while (commandStack._stackIdx > startIdx && commandStack.canUndo()) {
      commandStack.undo();
    }
    await syncXml(diagram);
  }
}

/** Run lint on all affected diagrams and append feedback. */
async function appendBatchLintFeedback(
  result: ToolResult,
  operations: BatchOperationsArgs['operations']
): Promise<ToolResult> {
  const diagramIds = new Set<string>();
  for (const op of operations) {
    const id = op.args?.diagramId;
    if (id) diagramIds.add(id);
  }
  let lintResult = result;
  for (const id of diagramIds) {
    const diagram = getDiagram(id);
    if (diagram) lintResult = await appendLintFeedback(lintResult, diagram);
  }
  return lintResult;
}

export async function handleBatchOperations(args: BatchOperationsArgs): Promise<ToolResult> {
  validateArgs(args, ['operations']);
  const { operations, stopOnError = true } = args;

  if (!Array.isArray(operations) || operations.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, 'operations must be a non-empty array');
  }

  for (const op of operations) {
    if (op.tool === 'batch_bpmn_operations') {
      throw new McpError(ErrorCode.InvalidParams, 'Nested batch operations are not allowed');
    }
  }

  setBatchMode(true);
  const commandStackDepths = captureCommandStackPositions(operations);

  const results: Array<{
    index: number;
    tool: string;
    success: boolean;
    result?: any;
    error?: string;
  }> = [];
  let rolledBack = false;

  try {
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      try {
        const result = await dispatchToolCall(op.tool, op.args);
        let parsed: any;
        try {
          parsed = JSON.parse(result.content[0]?.text || '{}');
        } catch {
          parsed = result.content[0]?.text;
        }
        results.push({ index: i, tool: op.tool, success: true, result: parsed });
      } catch (err: any) {
        results.push({
          index: i,
          tool: op.tool,
          success: false,
          error: err?.message || String(err),
        });
        if (stopOnError) {
          await rollbackDiagrams(commandStackDepths);
          rolledBack = true;
          break;
        }
      }
    }
  } finally {
    setBatchMode(false);
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  const batchResult = jsonResult({
    success: failCount === 0,
    totalOperations: operations.length,
    executed: results.length,
    succeeded: successCount,
    failed: failCount,
    ...(rolledBack ? { rolledBack: true } : {}),
    results,
    message:
      failCount === 0
        ? `All ${successCount} operations completed successfully`
        : rolledBack
          ? `${failCount} operation(s) failed — all changes rolled back`
          : `${failCount} operation(s) failed out of ${results.length} executed`,
  });

  return appendBatchLintFeedback(batchResult, operations);
}

export const TOOL_DEFINITION = {
  name: 'batch_bpmn_operations',
  description:
    'Execute multiple BPMN operations in a single call, reducing round-trips. Operations run sequentially. ' +
    'By default, execution stops on first error (set stopOnError: false to continue). ' +
    'When stopOnError is true (default), all changes are rolled back on failure using the bpmn-js command stack. ' +
    'Nested batch calls are not allowed.',
  inputSchema: {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tool: {
              type: 'string',
              description:
                'The tool name to invoke (e.g. "add_bpmn_element", "connect_bpmn_elements")',
            },
            args: {
              type: 'object',
              description: 'Arguments to pass to the tool',
              additionalProperties: true,
            },
          },
          required: ['tool', 'args'],
        },
        description: 'Array of operations to execute sequentially',
      },
      stopOnError: {
        type: 'boolean',
        description:
          'Stop on first error (default: true). Set to false to continue executing remaining operations.',
      },
    },
    required: ['operations'],
  },
} as const;
