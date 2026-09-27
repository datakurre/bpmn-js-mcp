/**
 * BPMN tool module — registers all BPMN MCP tools.
 *
 * Implements the generic ToolModule interface so the MCP server can
 * aggregate tools from multiple editor back-ends (BPMN, DMN, Forms, …).
 */

import { type ToolResult, type ToolContext } from './types';
import { type ToolModule } from './module';
import { TOOL_DEFINITIONS, ALL_DISPATCHABLE_TOOL_NAMES, dispatchToolCall } from './handlers';

/**
 * Every tool name this module dispatches, for fast lookup.  Built from all
 * registered tools, not just the listed `TOOL_DEFINITIONS`, so hidden aliases
 * and tools outside the active tier (`BPMN_MCP_TOOLS=core`) stay callable.
 */
const toolNames: Set<string> = new Set(ALL_DISPATCHABLE_TOOL_NAMES);

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
