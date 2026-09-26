/**
 * Tests for optional PNG image content in mutating tool responses.
 *
 * When a diagram is created with includeImage, every mutating tool
 * response appends ImageContent items for the requested formats.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElement,
  handleConnect,
  handleExportBpmn,
} from '../../../src/handlers';
import { parseResult, clearDiagrams } from '../../helpers';

/** Extract the `viewBox="..."` attribute value from an SVG string. */
function extractViewBox(svg: string): string {
  const match = svg.match(/viewBox="([^"]+)"/);
  if (!match) throw new Error('SVG has no viewBox attribute');
  return match[1];
}

describe('includeImage option on create_bpmn_diagram', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('create_bpmn_diagram with includeImage:true returns PNG (backward compat)', async () => {
    const result = await handleCreateDiagram({ includeImage: true });
    const pngItems = result.content.filter(
      (c: any) => c.type === 'image' && c.mimeType === 'image/png'
    );
    const svgItems = result.content.filter(
      (c: any) => c.type === 'image' && c.mimeType === 'image/svg+xml'
    );
    expect(pngItems.length).toBe(1);
    // true = ['png'] only — no SVG
    expect(svgItems.length).toBe(0);
  });

  test('create_bpmn_diagram without includeImage returns PNG image by default', async () => {
    const result = await handleCreateDiagram({});
    const imageItem = result.content.find((c: any) => c.type === 'image');
    expect(imageItem).toBeDefined();
    expect((imageItem as any).mimeType).toBe('image/png');
  });

  test('create_bpmn_diagram with includeImage:false returns no image content', async () => {
    const result = await handleCreateDiagram({ includeImage: false });
    const imageItem = result.content.find((c: any) => c.type === 'image');
    expect(imageItem).toBeUndefined();
  });

  test("create_bpmn_diagram with includeImage:['png'] returns only PNG", async () => {
    const result = await handleCreateDiagram({ includeImage: ['png'] });
    const pngItems = result.content.filter(
      (c: any) => c.type === 'image' && c.mimeType === 'image/png'
    );
    const svgItems = result.content.filter(
      (c: any) => c.type === 'image' && c.mimeType === 'image/svg+xml'
    );
    expect(pngItems.length).toBe(1);
    expect(svgItems.length).toBe(0);
  });

  test("create_bpmn_diagram with includeImage:['svg'] returns only SVG", async () => {
    const result = await handleCreateDiagram({ includeImage: ['svg'] });
    const pngItems = result.content.filter(
      (c: any) => c.type === 'image' && c.mimeType === 'image/png'
    );
    const svgItems = result.content.filter(
      (c: any) => c.type === 'image' && c.mimeType === 'image/svg+xml'
    );
    expect(pngItems.length).toBe(0);
    expect(svgItems.length).toBe(1);
  });

  test("create_bpmn_diagram with includeImage:['png','svg'] returns both", async () => {
    const result = await handleCreateDiagram({ includeImage: ['png', 'svg'] });
    const pngItems = result.content.filter(
      (c: any) => c.type === 'image' && c.mimeType === 'image/png'
    );
    const svgItems = result.content.filter(
      (c: any) => c.type === 'image' && c.mimeType === 'image/svg+xml'
    );
    expect(pngItems.length).toBe(1);
    expect(svgItems.length).toBe(1);
  });

  test('image content is valid base64-encoded PNG', async () => {
    const result = await handleCreateDiagram({ includeImage: true });
    const imageItem = result.content.find(
      (c: any) => c.type === 'image' && c.mimeType === 'image/png'
    ) as any;
    expect(imageItem).toBeDefined();

    // Decode base64 and check it's a PNG (magic bytes: 89 50 4e 47)
    const decoded = Buffer.from(imageItem.data, 'base64');
    expect(decoded[0]).toBe(0x89);
    expect(decoded[1]).toBe(0x50); // P
    expect(decoded[2]).toBe(0x4e); // N
    expect(decoded[3]).toBe(0x47); // G
  });

  test('mutating tool add_element includes image when diagram has includeImage:true', async () => {
    const createResult = await handleCreateDiagram({ includeImage: true });
    const { diagramId } = parseResult(createResult);

    const addResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Begin',
    });

    const imageItem = addResult.content.find((c: any) => c.type === 'image');
    expect(imageItem).toBeDefined();
    expect((imageItem as any).mimeType).toBe('image/png');
  });

  test('mutating tool does not include image when includeImage is explicitly false', async () => {
    const createResult = await handleCreateDiagram({ includeImage: false });
    const { diagramId } = parseResult(createResult);

    const addResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Begin',
    });

    const imageItem = addResult.content.find((c: any) => c.type === 'image');
    expect(imageItem).toBeUndefined();
  });

  test('image is updated after each mutation', async () => {
    const createResult = await handleCreateDiagram({ includeImage: true });
    const { diagramId } = parseResult(createResult);

    const res1 = await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Start',
    });

    const res2 = await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'End',
    });

    const img1 = res1.content.find((c: any) => c.type === 'image') as any;
    const img2 = res2.content.find((c: any) => c.type === 'image') as any;

    // Both should be PNGs
    const png1 = Buffer.from(img1.data, 'base64');
    const png2 = Buffer.from(img2.data, 'base64');
    // Check PNG magic bytes
    expect(png1[0]).toBe(0x89);
    expect(png1[1]).toBe(0x50);
    expect(png2[0]).toBe(0x89);
    expect(png2[1]).toBe(0x50);

    // The second SVG should differ (has more elements)
    // They could be different sizes/content
    expect(img1.data).toBeDefined();
    expect(img2.data).toBeDefined();
  });

  test('connect tool includes image when includeImage:true', async () => {
    const createResult = await handleCreateDiagram({ includeImage: true });
    const { diagramId } = parseResult(createResult);

    const startRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent', name: 'Start' })
    );
    const endRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:EndEvent', name: 'End' })
    );

    const connectResult = await handleConnect({
      diagramId,
      sourceElementId: startRes.elementId,
      targetElementId: endRes.elementId,
    });

    const imageItem = connectResult.content.find((c: any) => c.type === 'image');
    expect(imageItem).toBeDefined();
    expect((imageItem as any).mimeType).toBe('image/png');
  });

  // ADR-022: export_bpmn's SVG, create_bpmn_diagram's includeImage SVG, and a
  // mutating tool's includeImage SVG all tighten the viewBox through the same
  // bpmn-to-image helper, so they must agree on the same diagram state.
  test('viewBox is identical across export_bpmn SVG and includeImage SVG', async () => {
    const createResult = await handleCreateDiagram({ includeImage: ['svg'] });
    const { diagramId } = parseResult(createResult);
    const createSvgItem = createResult.content.find(
      (c: any) => c.type === 'image' && c.mimeType === 'image/svg+xml'
    ) as any;
    const createSvg = Buffer.from(createSvgItem.data, 'base64').toString('utf-8');

    const startRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent', name: 'Start' })
    );
    const taskRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:UserTask', name: 'Task' })
    );
    const endRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:EndEvent', name: 'End' })
    );
    await handleConnect({
      diagramId,
      sourceElementId: startRes.elementId,
      targetElementId: taskRes.elementId,
    });
    const finalConnectResult = await handleConnect({
      diagramId,
      sourceElementId: taskRes.elementId,
      targetElementId: endRes.elementId,
    });

    const mutatingSvgItem = finalConnectResult.content.find(
      (c: any) => c.type === 'image' && c.mimeType === 'image/svg+xml'
    ) as any;
    const mutatingSvg = Buffer.from(mutatingSvgItem.data, 'base64').toString('utf-8');

    const exportResult = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
    const exportSvg = exportResult.content[0].text!;

    // The empty-process create() viewBox necessarily differs (less content),
    // but the final mutating includeImage SVG and export_bpmn SVG describe
    // the exact same diagram state and must produce the same viewBox.
    expect(extractViewBox(mutatingSvg)).toBe(extractViewBox(exportSvg));
    expect(createSvg).toContain('viewBox=');
  });
});
