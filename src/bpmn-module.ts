/**
 * BPMN tool module — registers all BPMN MCP tools.
 *
 * Implements the generic ToolModule interface so the MCP server can
 * aggregate tools from multiple editor back-ends (BPMN, DMN, Forms, …).
 */

import { type ToolResult, type ToolContext } from './types';
import { type ToolModule } from './module';
import { TOOL_DEFINITIONS, dispatchToolCall } from './handlers';

/** Set of tool names owned by this module, for fast lookup. */
const toolNames: Set<string> = new Set(TOOL_DEFINITIONS.map((td) => td.name));

export const bpmnModule: ToolModule = {
  name: 'bpmn',
  toolDefinitions: TOOL_DEFINITIONS,

  dispatch(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolContext
  ): Promise<ToolResult> | undefined {
    if (!toolNames.has(toolName)) return undefined;
    return dispatchToolCall(toolName, args, context);
  },
};
