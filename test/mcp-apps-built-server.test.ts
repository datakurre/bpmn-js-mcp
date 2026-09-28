/**
 * Reads `ui://bpmn-diagram-viewer` from the actual built server
 * (`dist/index.js`) over stdio, using the real MCP SDK client.
 *
 * `test/resources.test.ts` covers `renderAppViewerHtml()` at the source
 * level, which runs under vitest with `__dirname` pointing at
 * `src/mcp-apps/`. That masked a real bug: esbuild bundles this file
 * directly into `dist/index.js`, so at runtime `__dirname` is `dist/`
 * itself, not `dist/mcp-apps/` — `findViewerBundle()`'s path candidates
 * need to account for that layout too. This test exercises the resource
 * through the actual built artifact to catch that class of bundling
 * mismatch, which no purely source-level test can.
 *
 * It also checks MCP Apps host detection end to end: only a client that
 * advertises the `io.modelcontextprotocol/ui` extension in `initialize` sees
 * `_meta.ui.resourceUri` on tools and embedded diagram XML in results.
 *
 * Requires `npm run build` to have already produced `dist/index.js` and
 * `dist/mcp-apps-viewer-bundle.js` (CI always builds before testing).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const DIST_INDEX = path.resolve(__dirname, '..', 'dist', 'index.js');

const MCP_APPS_CAPABILITIES = {
  extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
};

async function connect(capabilities: Record<string, unknown> = {}): Promise<Client> {
  if (!fs.existsSync(DIST_INDEX)) {
    throw new Error(`${DIST_INDEX} not found — run \`npm run build\` before this test.`);
  }
  const client = new Client(
    { name: 'mcp-apps-built-server-test', version: '1.0.0' },
    { capabilities }
  );
  await client.connect(new StdioClientTransport({ command: 'node', args: [DIST_INDEX] }));
  return client;
}

/** Create a diagram and add one element; return the add call's content types. */
async function addElementContentTypes(client: Client): Promise<string[]> {
  const created = await client.callTool({
    name: 'create_bpmn_diagram',
    arguments: { includeImage: false },
  });
  const diagramId = JSON.parse((created.content as any[])[0].text).diagramId;
  const added = await client.callTool({
    name: 'add_bpmn_elements',
    arguments: { diagramId, elements: [{ elementType: 'bpmn:StartEvent' }] },
  });
  return (added.content as any[]).map((c) =>
    c.type === 'resource' ? `resource:${c.resource.mimeType}` : c.type
  );
}

describe('ui://bpmn-diagram-viewer via the built server (stdio)', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connect();
  });

  afterAll(async () => {
    await client?.close();
  });

  test('reads the viewer HTML resource without throwing', async () => {
    const result = await client.readResource({ uri: 'ui://bpmn-diagram-viewer' });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    const html = result.contents[0].text as string;
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('id="bpmn-app-view"');
    expect(html).toContain('TokenSimulation');
    expect(html).toContain('ontoolresult');
  });
});

describe('MCP Apps host detection via the built server (stdio)', () => {
  test('a client without the MCP Apps extension sees no ui meta or embedded XML', async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.filter((t) => t._meta?.ui)).toEqual([]);
      expect(await addElementContentTypes(client)).not.toContain('resource:application/xml');
    } finally {
      await client.close();
    }
  });

  test('a client with the MCP Apps extension gets ui meta and embedded XML', async () => {
    const client = await connect(MCP_APPS_CAPABILITIES);
    try {
      const { tools } = await client.listTools();
      const addElement = tools.find((t) => t.name === 'add_bpmn_elements');
      expect((addElement?._meta as any)?.ui?.resourceUri).toBe('ui://bpmn-diagram-viewer');
      const listElements = tools.find((t) => t.name === 'list_bpmn_elements');
      expect(listElements?._meta?.ui).toBeUndefined();
      expect(await addElementContentTypes(client)).toContain('resource:application/xml');
    } finally {
      await client.close();
    }
  });
});
