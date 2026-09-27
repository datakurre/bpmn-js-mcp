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
 * Requires `npm run build` to have already produced `dist/index.js` and
 * `dist/mcp-apps-viewer-bundle.js` (CI always builds before testing).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const DIST_INDEX = path.resolve(__dirname, '..', 'dist', 'index.js');

describe('ui://bpmn-diagram-viewer via the built server (stdio)', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    if (!fs.existsSync(DIST_INDEX)) {
      throw new Error(`${DIST_INDEX} not found — run \`npm run build\` before this test.`);
    }
    transport = new StdioClientTransport({ command: 'node', args: [DIST_INDEX] });
    client = new Client({ name: 'mcp-apps-built-server-test', version: '1.0.0' }, {});
    await client.connect(transport);
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
