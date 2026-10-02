/**
 * Tests for MCP Apps support (issue #11 / ADR-025):
 * - The server detects MCP Apps hosts from the `io.modelcontextprotocol/ui`
 *   extension in their `initialize` capabilities.
 * - Only for such hosts, mutating tools declare `_meta.ui.resourceUri`
 *   pointing at `ui://bpmn-diagram-viewer` (read-only tools and
 *   `delete_bpmn_diagram` never do), and tool results embed the diagram's
 *   current XML as an `audience: ['user']` resource content item, skipped
 *   past `LARGE_XML_CHARS`.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  TOOL_DEFINITIONS,
  withMcpAppsMeta,
  handleCreateDiagram,
  handleAddElement,
} from '../src/handlers';
import {
  detectMcpAppsSupport,
  setMcpAppsHostSupported,
  MCP_APPS_EXTENSION_ID,
} from '../src/mcp-apps/host-support';
import { clearDiagrams } from './helpers';
import { LARGE_XML_CHARS } from '../src/constants';

// Mirrors src/handlers/index.ts's READONLY_TOOLS.
const READONLY_TOOL_NAMES = new Set([
  'export_bpmn',
  'list_bpmn_diagrams',
  'list_bpmn_process_variables',
  'validate_bpmn_diagram',
  'list_bpmn_elements',
  'analyze_bpmn_lanes',
]);

describe('MCP Apps: host detection', () => {
  test('detects the extension with the viewer MIME type', () => {
    expect(
      detectMcpAppsSupport({
        extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: ['text/html;profile=mcp-app'] } },
      })
    ).toBe(true);
  });

  test('accepts the extension without a mimeTypes list', () => {
    expect(detectMcpAppsSupport({ extensions: { [MCP_APPS_EXTENSION_ID]: {} } })).toBe(true);
  });

  test('rejects hosts whose mimeTypes exclude the viewer MIME type', () => {
    expect(
      detectMcpAppsSupport({
        extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: ['text/html;profile=other'] } },
      })
    ).toBe(false);
  });

  test('rejects clients without the extension', () => {
    expect(detectMcpAppsSupport({})).toBe(false);
    expect(detectMcpAppsSupport(undefined)).toBe(false);
    expect(detectMcpAppsSupport({ extensions: { 'com.example/other': {} } })).toBe(false);
  });
});

describe('MCP Apps: _meta.ui.resourceUri on tool definitions', () => {
  const withMeta = withMcpAppsMeta(TOOL_DEFINITIONS);
  const find = (name: string) => withMeta.find((t) => t.name === name) as any;

  test('the default tool list carries no ui meta', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect((tool as any)._meta?.ui, `${tool.name} should have no ui meta`).toBeUndefined();
    }
  });

  test('mutating tools declare the diagram viewer resource', () => {
    expect(find('create_bpmn_diagram')._meta.ui.resourceUri).toBe('ui://bpmn-diagram-viewer');
    expect(find('add_bpmn_elements')._meta.ui.resourceUri).toBe('ui://bpmn-diagram-viewer');
  });

  test('read-only tools do not declare a ui.resourceUri', () => {
    for (const tool of withMeta) {
      if (READONLY_TOOL_NAMES.has(tool.name)) {
        expect((tool as any)._meta?.ui, `${tool.name} should have no ui meta`).toBeUndefined();
      }
    }
  });

  test('delete_bpmn_diagram does not declare a ui.resourceUri (nothing left to view)', () => {
    expect(find('delete_bpmn_diagram')._meta?.ui).toBeUndefined();
  });

  test('analyze_bpmn_lanes (read-only) does not declare a ui.resourceUri', () => {
    expect(find('analyze_bpmn_lanes')._meta?.ui).toBeUndefined();
  });

  test('delete_bpmn_element (still leaves a diagram) does declare a ui.resourceUri', () => {
    expect(find('delete_bpmn_element')._meta.ui.resourceUri).toBe('ui://bpmn-diagram-viewer');
  });
});

describe('MCP Apps: diagram XML embedding', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  afterEach(() => {
    setMcpAppsHostSupported(false);
  });

  function findXmlResourceItem(content: any[]): any {
    return content.find((c) => c.type === 'resource' && c.resource?.mimeType === 'application/xml');
  }

  async function createDiagramId(name?: string): Promise<string> {
    const result = await handleCreateDiagram({ name });
    return JSON.parse(result.content[0].text!).diagramId;
  }

  test('nothing is embedded for hosts without MCP Apps support', async () => {
    const created = await handleCreateDiagram({});
    expect(findXmlResourceItem(created.content)).toBeUndefined();

    const diagramId = JSON.parse(created.content[0].text!).diagramId;
    const added = await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent' });
    expect(findXmlResourceItem(added.content)).toBeUndefined();
  });

  test('create_bpmn_diagram embeds XML as audience:user content for MCP Apps hosts', async () => {
    setMcpAppsHostSupported(true);
    const result = await handleCreateDiagram({});
    const item = findXmlResourceItem(result.content);
    expect(item).toBeDefined();
    expect(item.resource.text).toContain('bpmn:definitions');
    expect(item.annotations).toEqual({ audience: ['user'] });
  });

  test('a later mutating call also embeds fresh XML for MCP Apps hosts', async () => {
    setMcpAppsHostSupported(true);
    const diagramId = await createDiagramId();

    const addResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Begin',
    });
    const item = findXmlResourceItem(addResult.content);
    expect(item).toBeDefined();
    expect(item.resource.text).toContain('Begin');
  });

  test('large diagram skips XML embedding even for MCP Apps hosts', async () => {
    setMcpAppsHostSupported(true);
    const diagramId = await createDiagramId('Big');

    let lastResult;
    for (let i = 0; i < 60; i++) {
      lastResult = await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: `Task number ${i} with a reasonably long descriptive name`,
      });
    }
    const xml = (await import('../src/diagram-manager')).getDiagram(diagramId)!.xml;
    expect(xml.length).toBeGreaterThan(LARGE_XML_CHARS);
    expect(findXmlResourceItem(lastResult!.content)).toBeUndefined();
  }, 30000);
});
