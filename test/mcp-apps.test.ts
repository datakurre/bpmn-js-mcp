/**
 * Tests for MCP Apps support (issue #11 / ADR-025):
 * - Mutating tools declare `_meta.ui.resourceUri` pointing at
 *   `ui://bpmn-diagram-viewer`; read-only tools and `delete_bpmn_diagram`
 *   don't.
 * - `create_bpmn_diagram`/mutating tools embed the diagram's current XML as
 *   an `audience: ['user']` resource content item when `includeAppView: true`
 *   (opt-in, independent of `includeImage`), skipped past `LARGE_XML_CHARS`.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { TOOL_DEFINITIONS, handleCreateDiagram, handleAddElement } from '../src/handlers';
import { clearDiagrams, createDiagram, addElement } from './helpers';
import { LARGE_XML_CHARS } from '../src/constants';

// Mirrors src/handlers/index.ts's READONLY_TOOLS. analyze_bpmn_lanes is
// deliberately not listed: its `redistribute` mode mutates lane assignment
// (see #21), so it gets a ui.resourceUri like any other mutating tool.
const READONLY_TOOL_NAMES = new Set([
  'export_bpmn',
  'list_bpmn_diagrams',
  'list_bpmn_process_variables',
  'validate_bpmn_diagram',
  'list_bpmn_elements',
  'get_bpmn_element_properties',
]);

describe('MCP Apps: _meta.ui.resourceUri on tool definitions', () => {
  test('mutating tools declare the diagram viewer resource', () => {
    const createDef = TOOL_DEFINITIONS.find((t) => t.name === 'create_bpmn_diagram') as any;
    expect(createDef._meta.ui.resourceUri).toBe('ui://bpmn-diagram-viewer');

    const addElementDef = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element') as any;
    expect(addElementDef._meta.ui.resourceUri).toBe('ui://bpmn-diagram-viewer');
  });

  test('read-only tools do not declare a ui.resourceUri', () => {
    for (const tool of TOOL_DEFINITIONS) {
      if (READONLY_TOOL_NAMES.has(tool.name)) {
        expect(
          (tool as any)._meta?.ui?.resourceUri,
          `${tool.name} should have no ui meta`
        ).toBeUndefined();
      }
    }
  });

  test('delete_bpmn_diagram does not declare a ui.resourceUri (nothing left to view)', () => {
    const def = TOOL_DEFINITIONS.find((t) => t.name === 'delete_bpmn_diagram') as any;
    expect(def._meta?.ui?.resourceUri).toBeUndefined();
  });

  test('analyze_bpmn_lanes (mutating in redistribute mode, #21) declares a ui.resourceUri', () => {
    const def = TOOL_DEFINITIONS.find((t) => t.name === 'analyze_bpmn_lanes') as any;
    expect(def._meta.ui.resourceUri).toBe('ui://bpmn-diagram-viewer');
  });

  test('delete_bpmn_element (still leaves a diagram) does declare a ui.resourceUri', () => {
    const def = TOOL_DEFINITIONS.find((t) => t.name === 'delete_bpmn_element') as any;
    expect(def._meta.ui.resourceUri).toBe('ui://bpmn-diagram-viewer');
  });
});

describe('MCP Apps: includeAppView content embedding', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  function findXmlResourceItem(content: any[]): any {
    return content.find((c) => c.type === 'resource' && c.resource?.mimeType === 'application/xml');
  }

  test('create_bpmn_diagram without includeAppView does not embed XML content', async () => {
    const result = await handleCreateDiagram({});
    expect(findXmlResourceItem(result.content)).toBeUndefined();
  });

  test('create_bpmn_diagram with includeAppView:true embeds XML as audience:user content', async () => {
    const result = await handleCreateDiagram({ includeAppView: true });
    const item = findXmlResourceItem(result.content);
    expect(item).toBeDefined();
    expect(item.resource.text).toContain('bpmn:definitions');
    expect(item.annotations).toEqual({ audience: ['user'] });
  });

  test('a later mutating call on an includeAppView diagram also embeds fresh XML', async () => {
    const createResult = await handleCreateDiagram({ includeAppView: true });
    const diagramId = JSON.parse(createResult.content[0].text!).diagramId;

    const addResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Begin',
    });
    const item = findXmlResourceItem(addResult.content);
    expect(item).toBeDefined();
    expect(item.resource.text).toContain('Begin');
  });

  test('a mutating call on a diagram without includeAppView does not embed XML', async () => {
    const diagramId = await createDiagram('No app view');
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Begin' });
    const addAgainResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Done',
    });
    expect(findXmlResourceItem(addAgainResult.content)).toBeUndefined();
  });

  test('large diagram skips XML embedding even with includeAppView:true', async () => {
    const createResult = await handleCreateDiagram({ includeAppView: true, name: 'Big' });
    const diagramId = JSON.parse(createResult.content[0].text!).diagramId;

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
