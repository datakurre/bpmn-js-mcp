/**
 * BPMN-MCP server entry point.
 *
 * Thin shell that wires MCP SDK transport ↔ tool definitions ↔ handlers.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_DEFINITIONS } from "./tool-definitions";
import { dispatchToolCall } from "./handlers";

const server = new Server(
  { name: "bpmn-js-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request: any): Promise<any> => {
  const { name, arguments: args } = request.params;
  return dispatchToolCall(name, args);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("BPMN.js MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
