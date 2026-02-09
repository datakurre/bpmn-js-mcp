import { describe, it, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleConnect } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('handleLayoutDiagram (ELK)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('runs ELK layout on a simple flow', async () => {
    const diagramId = await createDiagram('Simple ELK Test');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 100,
      y: 100,
    });
    await handleConnect({
      diagramId,
      sourceElementId: startId,
      targetElementId: endId,
    });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.elementCount).toBeGreaterThanOrEqual(2);
  });

  it('produces left-to-right ordering for a sequential flow', async () => {
    const diagramId = await createDiagram('Sequential Flow');
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 500,
      y: 500,
    });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Do Work',
      x: 500,
      y: 500,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 500,
      y: 500,
    });
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });

    await handleLayoutDiagram({ diagramId });

    // Verify left-to-right ordering: start.x < task.x < end.x
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const taskEl = reg.get(task);
    const endEl = reg.get(end);

    expect(startEl.x).toBeLessThan(taskEl.x);
    expect(taskEl.x).toBeLessThan(endEl.x);
  });

  it('handles parallel branches that reconverge', async () => {
    const diagramId = await createDiagram('Parallel Branches');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: split });
    await handleConnect({ diagramId, sourceElementId: split, targetElementId: taskA });
    await handleConnect({ diagramId, sourceElementId: split, targetElementId: taskB });
    await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: join, targetElementId: end });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(6);

    // Verify structure: split gateway is before both branches, join is after
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const splitEl = reg.get(split);
    const taskAEl = reg.get(taskA);
    const taskBEl = reg.get(taskB);
    const joinEl = reg.get(join);

    expect(splitEl.x).toBeLessThan(taskAEl.x);
    expect(splitEl.x).toBeLessThan(taskBEl.x);
    expect(taskAEl.x).toBeLessThan(joinEl.x);
    expect(taskBEl.x).toBeLessThan(joinEl.x);

    // Parallel branches should be at different Y positions
    expect(taskAEl.y).not.toBe(taskBEl.y);
  });

  it('handles exclusive gateway branches', async () => {
    const diagramId = await createDiagram('Exclusive Branches');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decision' });
    const yesTask = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Approve' });
    const noTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Reject' });
    const joinGw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: yesTask,
      label: 'Yes',
    });
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: noTask,
      label: 'No',
      isDefault: true,
    });
    await handleConnect({ diagramId, sourceElementId: yesTask, targetElementId: joinGw });
    await handleConnect({ diagramId, sourceElementId: noTask, targetElementId: joinGw });
    await handleConnect({ diagramId, sourceElementId: joinGw, targetElementId: end });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Verify the branches are positioned between the gateways
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    expect(reg.get(gw).x).toBeLessThan(reg.get(yesTask).x);
    expect(reg.get(gw).x).toBeLessThan(reg.get(noTask).x);
    expect(reg.get(yesTask).x).toBeLessThan(reg.get(joinGw).x);
  });

  it('handles diamond pattern with 5 branches', async () => {
    const diagramId = await createDiagram('Diamond 5');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const tasks: string[] = [];
    for (let i = 1; i <= 5; i++) {
      tasks.push(await addElement(diagramId, 'bpmn:UserTask', { name: `Task ${i}` }));
    }
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: split });
    for (const t of tasks) {
      await handleConnect({ diagramId, sourceElementId: split, targetElementId: t });
      await handleConnect({ diagramId, sourceElementId: t, targetElementId: join });
    }
    await handleConnect({ diagramId, sourceElementId: join, targetElementId: end });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(9); // start + split + 5 tasks + join + end

    // All 5 task branches should have distinct Y positions
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const yPositions = tasks.map((t) => reg.get(t).y);
    const uniqueY = new Set(yPositions);
    expect(uniqueY.size).toBe(5);
  });

  it('handles disconnected elements gracefully', async () => {
    const diagramId = await createDiagram('Disconnected');
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'A', x: 50, y: 50 });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'B', x: 50, y: 50 });
    // No connections — both elements are disconnected

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(2);
  });

  it('updates XML after layout', async () => {
    const diagramId = await createDiagram('XML Sync');
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 100,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 100,
      y: 100,
    });
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: end });

    await handleLayoutDiagram({ diagramId });

    // Verify XML was synced
    const diagram = getDiagram(diagramId)!;
    expect(diagram.xml).toContain('bpmndi:BPMNShape');
    expect(diagram.xml).toContain('bpmndi:BPMNEdge');
  });
});
