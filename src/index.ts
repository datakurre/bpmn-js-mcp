/**
 * bpmn-js-mcp server entry point.
 *
 * Thin shell that wires MCP SDK transport ↔ tool modules ↔ handlers.
 *
 * Tool modules are pluggable: each editor back-end (BPMN, DMN, Forms, …)
 * implements the ToolModule interface and registers its tools here.
 * Currently only the BPMN module is active.
 *
 * CLI usage:
 *   bpmn-js-mcp [options]
 *
 * Options:
 *   --persist-dir <dir>   Enable file-backed persistence in <dir>
 *   --help                Show usage information
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
import { enablePersistence } from './persistence';

// ── CLI argument parsing ───────────────────────────────────────────────────

interface CliOptions {
  persistDir?: string;
}

function printUsage(): void {
  console.error(`Usage: bpmn-js-mcp [options]

Options:
  --persist-dir <dir>   Enable file-backed diagram persistence in <dir>.
                        Diagrams are saved as .bpmn files and restored on startup.
  --help                Show this help message and exit.

Examples:
  bpmn-js-mcp
  bpmn-js-mcp --persist-dir ./diagrams

MCP configuration (.vscode/mcp.json):
  {
    "servers": {
      "bpmn": {
        "command": "npx",
        "args": ["bpmn-js-mcp", "--persist-dir", "./diagrams"]
      }
    }
  }
`);
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2); // skip node + script
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--persist-dir': {
        const dir = args[++i];
        if (!dir) {
          console.error('Error: --persist-dir requires a directory path');
          process.exit(1);
        }
        options.persistDir = dir;
        break;
      }
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  return options;
}

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
  const options = parseArgs(process.argv);

  // Enable file-backed persistence if requested
  if (options.persistDir) {
    const count = await enablePersistence(options.persistDir);
    console.error(`Persistence enabled in ${options.persistDir} (${count} diagram(s) loaded)`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('bpmn-js-mcp server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
