/**
 * Tests for MCP resources (bpmn:// URIs).
 */
import { describe, test, expect, afterEach } from 'vitest';
import { createDiagram, clearDiagrams, addElement } from './helpers';
import {
  listResources,
  readResource,
  RESOURCE_TEMPLATES,
  STATIC_RESOURCES,
} from '../src/resources';

afterEach(() => clearDiagrams());

describe('RESOURCE_TEMPLATES', () => {
  test('has templates for summary, lint, variables, xml, svg, and elements', () => {
    expect(RESOURCE_TEMPLATES).toHaveLength(6);
    const uris = RESOURCE_TEMPLATES.map((t) => t.uriTemplate);
    expect(uris).toContain('bpmn://diagram/{diagramId}/summary');
    expect(uris).toContain('bpmn://diagram/{diagramId}/lint');
    expect(uris).toContain('bpmn://diagram/{diagramId}/variables');
    expect(uris).toContain('bpmn://diagram/{diagramId}/xml');
    expect(uris).toContain('bpmn://diagram/{diagramId}/svg');
    expect(uris).toContain('bpmn://diagram/{diagramId}/elements');
  });
});

describe('STATIC_RESOURCES', () => {
  test('has the executable Camunda 7 guide', () => {
    expect(STATIC_RESOURCES.length).toBeGreaterThanOrEqual(1);
    const uris = STATIC_RESOURCES.map((r) => r.uri);
    expect(uris).toContain('bpmn://guides/executable-camunda7');
  });
});

describe('listResources', () => {
  test('returns bpmn://diagrams and static guides when no diagrams exist', () => {
    const resources = listResources();
    // 1 (diagrams list) + static resources
    expect(resources).toHaveLength(1 + STATIC_RESOURCES.length);
    const uris = resources.map((r: any) => r.uri);
    expect(uris).toContain('bpmn://diagrams');
    expect(uris).toContain('bpmn://guides/executable-camunda7');
  });

  test('returns per-diagram resources when diagrams exist', async () => {
    const id = await createDiagram('Test Process');
    const resources = listResources();
    // 1 (diagrams list) + static resources + 6 (summary, lint, variables, xml, svg, elements)
    expect(resources).toHaveLength(1 + STATIC_RESOURCES.length + 6);
    const uris = resources.map((r: any) => r.uri);
    expect(uris).toContain('bpmn://diagrams');
    expect(uris).toContain('bpmn://guides/executable-camunda7');
    expect(uris).toContain(`bpmn://diagram/${id}/summary`);
    expect(uris).toContain(`bpmn://diagram/${id}/lint`);
    expect(uris).toContain(`bpmn://diagram/${id}/variables`);
    expect(uris).toContain(`bpmn://diagram/${id}/xml`);
    expect(uris).toContain(`bpmn://diagram/${id}/svg`);
    expect(uris).toContain(`bpmn://diagram/${id}/elements`);
  });
});

describe('readResource', () => {
  test('reads bpmn://diagrams', async () => {
    await createDiagram('My Process');
    const result = await readResource('bpmn://diagrams');
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');
    const data = JSON.parse(result.contents[0].text);
    expect(data.count).toBe(1);
  });

  test('reads bpmn://diagram/{id}/summary', async () => {
    const id = await createDiagram('Summary Test');
    await addElement(id, 'bpmn:StartEvent', { name: 'Start' });
    const result = await readResource(`bpmn://diagram/${id}/summary`);
    expect(result.contents).toHaveLength(1);
    const data = JSON.parse(result.contents[0].text);
    expect(data.success).toBe(true);
  });

  test('reads bpmn://diagram/{id}/lint', async () => {
    const id = await createDiagram('Lint Test');
    const result = await readResource(`bpmn://diagram/${id}/lint`);
    expect(result.contents).toHaveLength(1);
    const data = JSON.parse(result.contents[0].text);
    expect(data.success).toBe(true);
    expect(typeof data.issueCount).toBe('number');
  });

  test('reads bpmn://diagram/{id}/variables', async () => {
    const id = await createDiagram('Vars Test');
    const result = await readResource(`bpmn://diagram/${id}/variables`);
    expect(result.contents).toHaveLength(1);
    const data = JSON.parse(result.contents[0].text);
    expect(data.success).toBe(true);
  });

  test('reads bpmn://diagram/{id}/xml', async () => {
    const id = await createDiagram('XML Test');
    await addElement(id, 'bpmn:StartEvent', { name: 'Start' });
    const result = await readResource(`bpmn://diagram/${id}/xml`);
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/xml');
    expect(result.contents[0].text).toContain('bpmn:definitions');
    expect(result.contents[0].text).toContain('StartEvent');
  });

  test('reads bpmn://diagram/{id}/svg', async () => {
    const id = await createDiagram('SVG Test');
    await addElement(id, 'bpmn:StartEvent', { name: 'Start' });
    const result = await readResource(`bpmn://diagram/${id}/svg`);
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('image/svg+xml');
    expect(result.contents[0].text).toContain('<svg');
    expect(result.contents[0].text).toContain('viewBox=');
  });

  test('reads bpmn://diagram/{id}/elements', async () => {
    const id = await createDiagram('Elements Test');
    await addElement(id, 'bpmn:UserTask', { name: 'My Task' });
    const result = await readResource(`bpmn://diagram/${id}/elements`);
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');
    const data = JSON.parse(result.contents[0].text);
    expect(data.elements.length).toBeGreaterThan(0);
  });

  test('throws on unknown URI', async () => {
    await expect(readResource('bpmn://unknown')).rejects.toThrow('Unknown resource URI');
  });

  test('throws on non-existent diagram', async () => {
    await expect(readResource('bpmn://diagram/nonexistent/summary')).rejects.toThrow(
      'Diagram not found'
    );
  });

  test('reads ui://bpmn-diagram-viewer (MCP Apps view)', async () => {
    const result = await readResource('ui://bpmn-diagram-viewer');
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    const html = result.contents[0].text;
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('id="bpmn-app-view"');
    expect(html).toContain('TokenSimulation');
    expect(html).toContain('ontoolresult');
  });

  test('reads bpmn://guides/executable-camunda7', async () => {
    const result = await readResource('bpmn://guides/executable-camunda7');
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(result.contents[0].text).toContain('Executable BPMN for Camunda 7');
    expect(result.contents[0].text).toContain('External Task pattern');
    expect(result.contents[0].text).toContain('Link events');
    expect(result.contents[0].text).toContain('implicit merge');
  });
});
