import { describe, test, expect, beforeEach } from 'vitest';
import { handleMoveElement, handleBpmnHistory } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, getRegistry } from '../../helpers';

describe('move_bpmn_element — moves (batch form)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('moves and resizes several elements in one call', async () => {
    const diagramId = await createDiagram();
    const task1 = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const task2 = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 300 });

    const res = parseResult(
      await handleMoveElement({
        diagramId,
        moves: [
          { elementId: task1, x: 300, y: 150 },
          { elementId: task2, width: 200, height: 120 },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.moved).toHaveLength(2);

    const registry = getRegistry(diagramId);
    const el1 = registry.get(task1);
    const el2 = registry.get(task2);
    expect(el1.x).toBe(300);
    expect(el1.y).toBe(150);
    expect(el2.width).toBe(200);
    expect(el2.height).toBe(120);
  });

  test('rejects when an item has no operation, applying nothing (all-or-nothing)', async () => {
    const diagramId = await createDiagram();
    const task1 = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const task2 = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 300 });
    const origX1 = getRegistry(diagramId).get(task1).x;
    const origX2 = getRegistry(diagramId).get(task2).x;

    await expect(
      handleMoveElement({
        diagramId,
        moves: [{ elementId: task1, x: 300, y: 150 }, { elementId: task2 }],
      })
    ).rejects.toThrow(/moves\[1\]/);

    const registry = getRegistry(diagramId);
    expect(registry.get(task1).x).toBe(origX1);
    expect(registry.get(task2).x).toBe(origX2);
  });

  test('rejects an unknown elementId, applying nothing (all-or-nothing)', async () => {
    const diagramId = await createDiagram();
    const task1 = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const origX1 = getRegistry(diagramId).get(task1).x;

    await expect(
      handleMoveElement({
        diagramId,
        moves: [
          { elementId: task1, x: 300, y: 150 },
          { elementId: 'ghost', x: 10, y: 10 },
        ],
      })
    ).rejects.toThrow(/ghost/);

    const registry = getRegistry(diagramId);
    expect(registry.get(task1).x).toBe(origX1);
  });

  test('groups the whole batch into a single undo step', async () => {
    const diagramId = await createDiagram();
    const task1 = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const task2 = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 300 });
    const origX1 = getRegistry(diagramId).get(task1).x;
    const origX2 = getRegistry(diagramId).get(task2).x;

    await handleMoveElement({
      diagramId,
      moves: [
        { elementId: task1, x: 300, y: 150 },
        { elementId: task2, x: 500, y: 350 },
      ],
    });

    let registry = getRegistry(diagramId);
    expect(registry.get(task1).x).toBe(300);
    expect(registry.get(task2).x).toBe(500);

    const undoResult = parseResult(
      await handleBpmnHistory({ diagramId, action: 'undo', steps: 1 })
    );
    expect(undoResult.stepsPerformed).toBe(1);

    registry = getRegistry(diagramId);
    expect(registry.get(task1).x).toBe(origX1);
    expect(registry.get(task2).x).toBe(origX2);
  });

  test('rejects an empty moves array', async () => {
    const diagramId = await createDiagram();
    await expect(handleMoveElement({ diagramId, moves: [] })).rejects.toThrow();
  });
});
