import { describe, test, expect, beforeEach } from 'vitest';
import { handleAlignElements, handleGetProperties } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('handleAlignElements', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('aligns elements to the left', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', {
      x: 100,
      y: 100,
    });
    const bId = await addElement(diagramId, 'bpmn:Task', {
      x: 300,
      y: 200,
    });

    const res = parseResult(
      await handleAlignElements({
        diagramId,
        elementIds: [aId, bId],
        alignment: 'left',
      })
    );
    expect(res.success).toBe(true);
    expect(res.alignedCount).toBe(2);
  });

  test('aligns elements right', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 300, y: 200 });
    const res = parseResult(
      await handleAlignElements({
        diagramId,
        elementIds: [aId, bId],
        alignment: 'right',
      })
    );
    expect(res.success).toBe(true);
  });

  test('aligns elements center', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 300, y: 200 });
    const res = parseResult(
      await handleAlignElements({
        diagramId,
        elementIds: [aId, bId],
        alignment: 'center',
      })
    );
    expect(res.success).toBe(true);
  });

  test('aligns elements top', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 300, y: 300 });
    const res = parseResult(
      await handleAlignElements({
        diagramId,
        elementIds: [aId, bId],
        alignment: 'top',
      })
    );
    expect(res.success).toBe(true);
  });

  test('aligns elements bottom', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 300, y: 300 });
    const res = parseResult(
      await handleAlignElements({
        diagramId,
        elementIds: [aId, bId],
        alignment: 'bottom',
      })
    );
    expect(res.success).toBe(true);
  });

  test('aligns elements middle', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 300, y: 300 });
    const res = parseResult(
      await handleAlignElements({
        diagramId,
        elementIds: [aId, bId],
        alignment: 'middle',
      })
    );
    expect(res.success).toBe(true);
  });

  test('compact mode redistributes along perpendicular axis (horizontal)', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 300 });
    const res = parseResult(
      await handleAlignElements({
        diagramId,
        elementIds: [aId, bId],
        alignment: 'top',
        compact: true,
      })
    );
    expect(res.success).toBe(true);
    expect(res.compact).toBe(true);
  });

  test('compact mode redistributes along perpendicular axis (vertical)', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 300, y: 100 });
    const res = parseResult(
      await handleAlignElements({
        diagramId,
        elementIds: [aId, bId],
        alignment: 'left',
        compact: true,
      })
    );
    expect(res.success).toBe(true);
    expect(res.compact).toBe(true);
    // Verify elements were actually moved
    const propsA = parseResult(await handleGetProperties({ diagramId, elementId: aId }));
    const propsB = parseResult(await handleGetProperties({ diagramId, elementId: bId }));
    expect(propsB.y).toBeGreaterThan(propsA.y);
  });

  test('throws with fewer than 2 elements', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', {
      x: 100,
      y: 100,
    });
    await expect(
      handleAlignElements({
        diagramId,
        elementIds: [aId],
        alignment: 'top',
      })
    ).rejects.toThrow(/at least 2/);
  });
});
