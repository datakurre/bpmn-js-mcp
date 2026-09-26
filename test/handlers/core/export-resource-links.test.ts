/**
 * Tests for export_bpmn's large-diagram resource_link summarization (ADR-023):
 * xml/svg/both content beyond LARGE_XML_CHARS is replaced with a
 * bpmn://diagram/{id}/xml|svg resource_link + short summary, unless
 * `inline: true` is passed.
 */
import { describe, test, expect } from 'vitest';
import { handleCreateDiagram, handleAddElement, handleExportBpmn } from '../../../src/handlers';
import { createDiagram, createSimpleProcess, clearDiagrams } from '../../helpers';
import { LARGE_XML_CHARS } from '../../../src/constants';

/** Build a diagram whose exported XML comfortably exceeds LARGE_XML_CHARS. */
async function createLargeDiagram(): Promise<string> {
  const create = await handleCreateDiagram({ name: 'Large diagram' });
  const diagramId = JSON.parse(create.content[0].text).diagramId;
  for (let i = 0; i < 60; i++) {
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: `Task number ${i} with a reasonably long descriptive name`,
    });
  }
  return diagramId;
}

describe('export_bpmn — resource_link summarization for large exports', () => {
  test('small diagram still returns full inline text by default', async () => {
    const diagramId = await createDiagram('Small');
    await createSimpleProcess(diagramId);

    const result = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true } as any);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('bpmn:definitions');
  });

  test('large diagram returns a resource_link instead of inline xml', async () => {
    clearDiagrams();
    const diagramId = await createLargeDiagram();

    const result = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true } as any);
    const linkItem = result.content[0] as any;
    expect(linkItem.type).toBe('resource_link');
    expect(linkItem.uri).toBe(`bpmn://diagram/${diagramId}/xml`);
    expect(linkItem.mimeType).toBe('application/xml');
    expect(linkItem.text).toBeUndefined();
  }, 30000);

  test('large diagram with inline:true still returns full text', async () => {
    clearDiagrams();
    const diagramId = await createLargeDiagram();

    const result = await handleExportBpmn({
      diagramId,
      format: 'xml',
      skipLint: true,
      inline: true,
    } as any);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text!.length).toBeGreaterThan(LARGE_XML_CHARS);
  }, 30000);

  test('the resource_link URI is actually readable via readResource', async () => {
    clearDiagrams();
    const diagramId = await createLargeDiagram();
    const { readResource } = await import('../../../src/resources');

    const result = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true } as any);
    const linkItem = result.content[0] as any;

    const resource = await readResource(linkItem.uri);
    expect(resource.contents[0].text).toContain('bpmn:definitions');
    expect(resource.contents[0].text.length).toBeGreaterThan(LARGE_XML_CHARS);
  }, 30000);

  test('format "both" summarizes xml and svg independently', async () => {
    clearDiagrams();
    const diagramId = await createLargeDiagram();

    const result = await handleExportBpmn({ diagramId, format: 'both', skipLint: true } as any);
    const [xmlItem, svgItem] = result.content as any[];
    expect(xmlItem.type).toBe('resource_link');
    expect(xmlItem.uri).toBe(`bpmn://diagram/${diagramId}/xml`);
    // SVG for the same diagram may or may not cross the threshold on its own;
    // either way it must be a well-formed content item.
    expect(['text', 'resource_link']).toContain(svgItem.type);
    if (svgItem.type === 'resource_link') {
      expect(svgItem.uri).toBe(`bpmn://diagram/${diagramId}/svg`);
    }
  }, 30000);

  test('filePath still receives the full content even when the response is summarized', async () => {
    clearDiagrams();
    const diagramId = await createLargeDiagram();
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bpmn-mcp-')), 'large.bpmn');

    const result = await handleExportBpmn({
      diagramId,
      format: 'xml',
      skipLint: true,
      filePath,
    } as any);

    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written.length).toBeGreaterThan(LARGE_XML_CHARS);
    expect((result.content[0] as any).type).toBe('resource_link');
    const confirmation = result.content.find((c: any) => c.text?.includes('Written to'));
    expect(confirmation).toBeDefined();
  }, 30000);
});
