import { describe, test, expect, beforeEach } from 'vitest';
import { handleDistributeElements } from '../../src/handlers/align-elements';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('align_bpmn_elements — distribute', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('distributes elements horizontally (even)', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 200, y: 100 });
    const cId = await addElement(diagramId, 'bpmn:Task', { x: 500, y: 100 });

    const res = parseResult(
      await handleDistributeElements({
        diagramId,
        elementIds: [aId, bId, cId],
        orientation: 'horizontal',
      })
    );
    expect(res.success).toBe(true);
    expect(res.distributedCount).toBe(3);
  });

  test('distributes elements horizontally with fixed gap', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 200, y: 100 });
    const cId = await addElement(diagramId, 'bpmn:Task', { x: 500, y: 100 });

    const res = parseResult(
      await handleDistributeElements({
        diagramId,
        elementIds: [aId, bId, cId],
        orientation: 'horizontal',
        gap: 50,
      })
    );
    expect(res.success).toBe(true);
    expect(res.gap).toBe(50);
  });

  test('distributes elements vertically (even)', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 250 });
    const cId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 500 });

    const res = parseResult(
      await handleDistributeElements({
        diagramId,
        elementIds: [aId, bId, cId],
        orientation: 'vertical',
      })
    );
    expect(res.success).toBe(true);
    expect(res.distributedCount).toBe(3);
  });

  test('distributes elements vertically with fixed gap', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 250 });
    const cId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 500 });

    const res = parseResult(
      await handleDistributeElements({
        diagramId,
        elementIds: [aId, bId, cId],
        orientation: 'vertical',
        gap: 40,
      })
    );
    expect(res.success).toBe(true);
    expect(res.gap).toBe(40);
  });

  test('throws with fewer than 3 elements', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const bId = await addElement(diagramId, 'bpmn:Task', { x: 200, y: 100 });
    await expect(
      handleDistributeElements({
        diagramId,
        elementIds: [aId, bId],
        orientation: 'horizontal',
      })
    ).rejects.toThrow(/at least 3/);
  });
});
