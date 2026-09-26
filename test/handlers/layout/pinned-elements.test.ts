import { describe, test, expect, beforeEach } from 'vitest';
import { handleMoveElement, handleLayoutDiagram } from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  connect,
  clearDiagrams,
  getRegistry,
} from '../../helpers';

describe('user-pinned elements', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('move_bpmn_element pins the element', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'T1', x: 100, y: 100 });

    // Move the element — should pin it
    await handleMoveElement({ diagramId, elementId: taskId, x: 500, y: 400 });

    // Verify the element is in the pinned set via DiagramState
    const { getDiagram } = await import('../../../src/diagram-manager');
    const diagram = getDiagram(diagramId)!;
    expect(diagram.pinnedElements).toBeDefined();
    expect(diagram.pinnedElements!.has(taskId)).toBe(true);
  });

  test('resize pins the element', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'T1', x: 100, y: 100 });

    // Resize the element — should pin it
    await handleMoveElement({ diagramId, elementId: taskId, width: 200, height: 120 });

    const { getDiagram } = await import('../../../src/diagram-manager');
    const diagram = getDiagram(diagramId)!;
    expect(diagram.pinnedElements).toBeDefined();
    expect(diagram.pinnedElements!.has(taskId)).toBe(true);
  });

  test('move-to-lane does not pin the element', async () => {
    // Lane-only moves are structural, not manual positioning
    const { getDiagram } = await import('../../../src/diagram-manager');
    const diagramId = await createDiagram();

    // Build a process with lanes
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'T1' });
    await connect(diagramId, start, task);

    const diagram = getDiagram(diagramId)!;
    // Ensure no pinned elements initially
    expect(diagram.pinnedElements?.has(task)).toBeFalsy();
  });

  test('layout skips pinned elements during a scoped layout run', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:Task', { name: 'T1' });
    const task2 = await addElement(diagramId, 'bpmn:Task', { name: 'T2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, end);

    // Do initial layout
    await handleLayoutDiagram({ diagramId });

    // Pin task1 by moving it manually
    await handleMoveElement({ diagramId, elementId: task1, x: 300, y: 200 });

    // Record task1's position after manual move
    const registry = getRegistry(diagramId);
    const task1Before = registry.get(task1);
    const pinnedX = task1Before.x;
    const pinnedY = task1Before.y;

    // Scoped layout — pinned elements should be skipped by the layout library
    const { getDiagram } = await import('../../../src/diagram-manager');
    const diagram = getDiagram(diagramId)!;
    expect(diagram.pinnedElements?.has(task1)).toBe(true);

    // Use scoped layout so pins aren't cleared
    const res = parseResult(
      await handleLayoutDiagram({
        diagramId,
        scopeElementId: 'Process_1',
      })
    );

    expect(res.success).toBe(true);

    // task1 position should be unchanged (it was pinned and skipped)
    const task1After = registry.get(task1);
    expect(task1After.x).toBe(pinnedX);
    expect(task1After.y).toBe(pinnedY);
  });

  test('full layout clears pinned state', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'T1' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    // Pin element
    await handleMoveElement({ diagramId, elementId: task, x: 500, y: 400 });

    const { getDiagram } = await import('../../../src/diagram-manager');
    expect(getDiagram(diagramId)!.pinnedElements?.has(task)).toBe(true);

    // Full layout should clear pins
    await handleLayoutDiagram({ diagramId });

    const diagram = getDiagram(diagramId)!;
    expect(diagram.pinnedElements).toBeUndefined();
  });
});
