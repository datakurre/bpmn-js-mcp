/**
 * Generic tool-module interface.
 *
 * Each editor back-end (BPMN, DMN, Form-JS, …) implements this interface
 * to register its tool definitions and dispatch logic with the MCP server.
 *
 * The server entry point collects an array of ToolModules and exposes
 * their combined tool surface over stdio.
 */

import { type ToolResult } from './types';

/** A pluggable module that contributes MCP tools. */
export interface ToolModule {
  /** Human-readable module name (e.g. "bpmn", "dmn", "form"). */
  readonly name: string;

  /** MCP tool definitions contributed by this module. */
  readonly toolDefinitions: readonly any[];

  /**
   * Attempt to handle a tool call.
   *
   * Returns a `ToolResult` if the tool name belongs to this module,
   * or `undefined` to let the next module try.
   */
  dispatch(toolName: string, args: any): Promise<ToolResult> | undefined;
}
