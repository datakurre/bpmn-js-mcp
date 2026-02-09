/**
 * bpmn-js-mcp server entry point.
 *
 * Thin shell that wires MCP SDK transport ↔ tool modules ↔ handlers.
 *
 * Tool modules are pluggable: each editor back-end (BPMN, DMN, Forms, …)
 * implements the ToolModule interface and registers its tools here.
 * Currently only the BPMN module is active.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { type ToolModule } from './module';
import { bpmnModule } from './bpmn-module';

// ── Registered tool modules ────────────────────────────────────────────────
// Add new editor modules here (e.g. dmnModule, formModule) when available.
const modules: ToolModule[] = [bpmnModule];

const server = new Server(
  { name: 'bpmn-js-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: modules.flatMap((m) => m.toolDefinitions),
}));

server.setRequestHandler(CallToolRequestSchema, async (request: any): Promise<any> => {
  const { name, arguments: args } = request.params;

  for (const mod of modules) {
    const result = mod.dispatch(name, args);
    if (result) return result;
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('bpmn-js-mcp server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
