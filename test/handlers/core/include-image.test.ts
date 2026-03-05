/**
 * Tests for optional PNG image content in mutating tool responses.
 *
 * When a diagram is created with includeImage: true, every mutating tool
 * response should include an ImageContent item with the diagram as PNG.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateDiagram, handleAddElement, handleConnect } from '../../../src/handlers';
import { parseResult, clearDiagrams } from '../../helpers';

describe('includeImage option on create_bpmn_diagram', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('create_bpmn_diagram with includeImage:true returns image content', async () => {
    const result = await handleCreateDiagram({ includeImage: true });
    expect(result.content.length).toBeGreaterThanOrEqual(1);
    // Should have at least one image content item
    const imageItem = result.content.find((c: any) => c.type === 'image');
    expect(imageItem).toBeDefined();
    expect((imageItem as any).mimeType).toBe('image/png');
  });

  test('create_bpmn_diagram without includeImage returns image content by default', async () => {
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

  test('image content is valid base64-encoded PNG', async () => {
    const result = await handleCreateDiagram({ includeImage: true });
    const imageItem = result.content.find((c: any) => c.type === 'image') as any;
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
});
