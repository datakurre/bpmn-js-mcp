import { describe, test, expect, beforeEach } from 'vitest';
import { handleListElements } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../helpers';

describe('list_bpmn_elements', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('lists added elements', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Task', { name: 'Do stuff' });

    const res = parseResult(await handleListElements({ diagramId }));
    expect(res.count).toBeGreaterThanOrEqual(1);
    const task = res.elements.find((e: any) => e.type === 'bpmn:Task');
    expect(task).toBeDefined();
    expect(task.name).toBe('Do stuff');
  });

  test('includes connection info for connected elements', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:StartEvent', {
      x: 100,
      y: 100,
    });
    const bId = await addElement(diagramId, 'bpmn:EndEvent', {
      x: 300,
      y: 100,
    });
    await connect(diagramId, aId, bId);

    const res = parseResult(await handleListElements({ diagramId }));
    const startEl = res.elements.find((e: any) => e.id === aId);
    expect(startEl.outgoing).toBeDefined();
    expect(startEl.outgoing.length).toBe(1);
  });

  test('includes connection source/target info', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:StartEvent', {
      x: 100,
      y: 100,
    });
    const bId = await addElement(diagramId, 'bpmn:EndEvent', {
      x: 300,
      y: 100,
    });
    await connect(diagramId, aId, bId);

    const res = parseResult(await handleListElements({ diagramId }));
    const flow = res.elements.find((e: any) => e.type === 'bpmn:SequenceFlow');
    expect(flow).toBeDefined();
    expect(flow.sourceId).toBe(aId);
    expect(flow.targetId).toBe(bId);
  });

  test('includes attachedToRef for boundary events', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Call API',
      x: 200,
      y: 100,
    });
    const boundaryId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timeout',
      hostElementId: taskId,
    });

    const res = parseResult(await handleListElements({ diagramId }));
    const boundary = res.elements.find((e: any) => e.id === boundaryId);
    expect(boundary).toBeDefined();
    expect(boundary.attachedToRef).toBe(taskId);
  });
});
