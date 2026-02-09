/**
 * Handler for batch_bpmn_operations tool.
 *
 * Accepts an array of operations and executes them sequentially,
 * reducing round-trips for complex diagram construction.
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { validateArgs, jsonResult } from './helpers';
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

export async function handleBatchOperations(args: BatchOperationsArgs): Promise<ToolResult> {
  validateArgs(args, ['operations']);
  const { operations, stopOnError = true } = args;

  if (!Array.isArray(operations) || operations.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, 'operations must be a non-empty array');
  }

  // Prevent recursive batch calls
  for (const op of operations) {
    if (op.tool === 'batch_bpmn_operations') {
      throw new McpError(ErrorCode.InvalidParams, 'Nested batch operations are not allowed');
    }
  }

  // Suppress intermediate lint feedback during batch execution
  setBatchMode(true);

  const results: Array<{
    index: number;
    tool: string;
    success: boolean;
    result?: any;
    error?: string;
  }> = [];

  try {
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      try {
        const result = await dispatchToolCall(op.tool, op.args);
        // Try to parse the result text as JSON for cleaner output
        let parsed: any;
        try {
          parsed = JSON.parse(result.content[0]?.text || '{}');
        } catch {
          parsed = result.content[0]?.text;
        }
        results.push({ index: i, tool: op.tool, success: true, result: parsed });
      } catch (err: any) {
        const errorMsg = err?.message || String(err);
        results.push({ index: i, tool: op.tool, success: false, error: errorMsg });
        if (stopOnError) {
          break;
        }
      }
    }
  } finally {
    setBatchMode(false);
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  // Run a single lint pass at the end for the affected diagram
  const batchResult = jsonResult({
    success: failCount === 0,
    totalOperations: operations.length,
    executed: results.length,
    succeeded: successCount,
    failed: failCount,
    results,
    message:
      failCount === 0
        ? `All ${successCount} operations completed successfully`
        : `${failCount} operation(s) failed out of ${results.length} executed`,
  });

  // Run lint pass for ALL affected diagrams, not just the first
  const diagramIds = new Set<string>();
  for (const op of operations) {
    const id = op.args?.diagramId;
    if (id) diagramIds.add(id);
  }

  let lintResult = batchResult;
  for (const id of diagramIds) {
    const diagram = getDiagram(id);
    if (diagram) {
      lintResult = await appendLintFeedback(lintResult, diagram);
    }
  }

  return lintResult;
}

export const TOOL_DEFINITION = {
  name: 'batch_bpmn_operations',
  description:
    'Execute multiple BPMN operations in a single call, reducing round-trips. Operations run sequentially. By default, execution stops on first error (set stopOnError: false to continue). Nested batch calls are not allowed.',
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
