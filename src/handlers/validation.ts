/**
 * @internal
 * Runtime argument validation for MCP tool handlers.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Validate that all `requiredKeys` are present and non-undefined in `args`.
 * Throws an MCP InvalidParams error with a clear message listing missing keys.
 */
export function validateArgs<T extends object>(args: T, requiredKeys: (keyof T & string)[]): void {
  const missing = requiredKeys.filter((key) => args[key] === undefined || args[key] === null);
  if (missing.length > 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Missing required argument(s): ${missing.join(', ')}`
    );
  }
}
