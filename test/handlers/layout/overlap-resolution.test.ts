import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('overlap resolution after layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('resolves overlaps when grid snap creates them', async () => {
    // Build a diagram where grid snap is likely to create overlaps:
    // many parallel branches with tight spacing
    const diagramId = await createDiagram('Overlap Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });
    const taskC = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task C' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, split);
    await connect(diagramId, split, taskA);
    await connect(diagramId, split, taskB);
    await connect(diagramId, split, taskC);
    await connect(diagramId, taskA, join);
    await connect(diagramId, taskB, join);
    await connect(diagramId, taskC, join);
    await connect(diagramId, join, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Verify no task elements overlap each other
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const tasks = [reg.get(taskA), reg.get(taskB), reg.get(taskC)];

    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i];
        const b = tasks[j];
        const overlapX = a.x < b.x + b.width && a.x + a.width > b.x;
        const overlapY = a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlapX && overlapY, `Tasks ${a.id} and ${b.id} should not overlap`).toBe(false);
      }
    }
  });

  test('does not move boundary events away from their host', async () => {
    const diagramId = await createDiagram('Boundary Overlap');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: task,
    });
    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Error End' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    await connect(diagramId, boundary, errorEnd);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Boundary event should still be attached to its host
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const boundaryEl = reg.get(boundary);
    const taskEl = reg.get(task);

    // Boundary event should be within or touching the host element's bounds
    const beCx = boundaryEl.x + (boundaryEl.width || 0) / 2;
    const beCy = boundaryEl.y + (boundaryEl.height || 0) / 2;
    const isNearHost =
      beCx >= taskEl.x - 20 &&
      beCx <= taskEl.x + taskEl.width + 20 &&
      beCy >= taskEl.y - 20 &&
      beCy <= taskEl.y + taskEl.height + 20;
    expect(isNearHost, 'Boundary event should stay near its host').toBe(true);
  });
});
