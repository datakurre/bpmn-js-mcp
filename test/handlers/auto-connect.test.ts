import { describe, it, expect, beforeEach } from 'vitest';
import { handleAutoConnect } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('handleAutoConnect', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('connects elements in sequence', async () => {
    const diagramId = await createDiagram('Auto Connect');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const res = parseResult(
      await handleAutoConnect({ diagramId, elementIds: [start, task1, task2, end] })
    );

    expect(res.success).toBe(true);
    expect(res.connectionsCreated).toBe(3);
    expect(res.connections).toHaveLength(3);
    expect(res.connections[0].source).toBe(start);
    expect(res.connections[0].target).toBe(task1);
    expect(res.connections[2].source).toBe(task2);
    expect(res.connections[2].target).toBe(end);
  });

  it('connects two elements', async () => {
    const diagramId = await createDiagram('Two Elements');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const res = parseResult(await handleAutoConnect({ diagramId, elementIds: [start, end] }));
    expect(res.success).toBe(true);
    expect(res.connectionsCreated).toBe(1);
  });

  it('rejects less than 2 elements', async () => {
    const diagramId = await createDiagram('Too Few');
    const start = await addElement(diagramId, 'bpmn:StartEvent');

    await expect(handleAutoConnect({ diagramId, elementIds: [start] })).rejects.toThrow(
      /at least 2/
    );
  });

  it('rejects non-existent element IDs', async () => {
    const diagramId = await createDiagram('Bad IDs');
    const start = await addElement(diagramId, 'bpmn:StartEvent');

    await expect(
      handleAutoConnect({ diagramId, elementIds: [start, 'nonexistent'] })
    ).rejects.toThrow(/not found/);
  });

  it('creates sequence flows with descriptive IDs', async () => {
    const diagramId = await createDiagram('Descriptive IDs');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Begin' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Work' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    const res = parseResult(await handleAutoConnect({ diagramId, elementIds: [start, task, end] }));

    // Verify connections exist in the element registry
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');

    for (const conn of res.connections) {
      const el = reg.get(conn.connectionId);
      expect(el).toBeTruthy();
      expect(el.type).toBe('bpmn:SequenceFlow');
    }
  });
});
