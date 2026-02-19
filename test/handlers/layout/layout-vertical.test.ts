/**
 * Tests for vertical (direction: 'DOWN') layout (I5).
 *
 * Verifies that `layout_bpmn_diagram` with `direction: 'DOWN'` produces
 * a top-to-bottom arrangement — elements flow from top to bottom instead
 * of the default left-to-right.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('layout direction DOWN', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('returns success for direction DOWN', async () => {
    const diagramId = await createDiagram('Vertical Direction');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const result = parseResult(await handleLayoutDiagram({ diagramId, direction: 'DOWN' }));
    expect(result.success).toBe(true);
  });

  test('linear flow with direction DOWN produces top-to-bottom ordering', async () => {
    const diagramId = await createDiagram('Vertical Linear');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Work' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    await handleLayoutDiagram({ diagramId, direction: 'DOWN' });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const taskEl = reg.get(task);
    const endEl = reg.get(end);

    // Top-to-bottom: start is above task, task is above end
    expect(startEl.y).toBeLessThan(taskEl.y);
    expect(taskEl.y).toBeLessThan(endEl.y);

    // All elements should be roughly horizontally centred (x close to each other)
    // with a reasonable tolerance for element width differences
    const xPositions = [startEl.x, taskEl.x, endEl.x];
    const minX = Math.min(...xPositions);
    const maxX = Math.max(...xPositions);
    expect(maxX - minX).toBeLessThan(200);
  });

  test('multi-step linear chain with direction DOWN keeps top-to-bottom order', async () => {
    const diagramId = await createDiagram('Vertical Chain');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Step 1' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Step 2' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Step 3' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, t3);
    await connect(diagramId, t3, end);

    await handleLayoutDiagram({ diagramId, direction: 'DOWN' });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const elements = [
      reg.get(start),
      reg.get(t1),
      reg.get(t2),
      reg.get(t3),
      reg.get(end),
    ];

    // Each element should be below the previous one
    for (let i = 0; i < elements.length - 1; i++) {
      expect(
        elements[i].y,
        `Element ${i} should be above element ${i + 1}`
      ).toBeLessThan(elements[i + 1].y);
    }
  });

  test('default direction RIGHT produces left-to-right ordering (regression)', async () => {
    const diagramId = await createDiagram('Horizontal Default');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Work' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    await handleLayoutDiagram({ diagramId }); // default is RIGHT

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const taskEl = reg.get(task);
    const endEl = reg.get(end);

    // Left-to-right: start is leftmost, end is rightmost
    expect(startEl.x).toBeLessThan(taskEl.x);
    expect(taskEl.x).toBeLessThan(endEl.x);
  });

  test('parallel branches with direction DOWN are arranged side by side', async () => {
    const diagramId = await createDiagram('Vertical Parallel');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, split);
    await connect(diagramId, split, taskA);
    await connect(diagramId, split, taskB);
    await connect(diagramId, taskA, join);
    await connect(diagramId, taskB, join);
    await connect(diagramId, join, end);

    await handleLayoutDiagram({ diagramId, direction: 'DOWN' });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const splitEl = reg.get(split);
    const joinEl = reg.get(join);
    const taskAEl = reg.get(taskA);
    const taskBEl = reg.get(taskB);

    // Split gateway should be above the branch tasks
    expect(splitEl.y).toBeLessThan(taskAEl.y);
    expect(splitEl.y).toBeLessThan(taskBEl.y);

    // Join gateway should be below the branch tasks
    expect(joinEl.y).toBeGreaterThan(taskAEl.y);
    expect(joinEl.y).toBeGreaterThan(taskBEl.y);

    // Branch tasks should be at approximately the same Y (same layer)
    expect(Math.abs(taskAEl.y - taskBEl.y)).toBeLessThan(50);
  });
});
