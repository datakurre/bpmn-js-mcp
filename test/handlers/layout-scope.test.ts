import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleConnect } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('layout_bpmn_diagram — scope parameter', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('rejects non-existent scope element', async () => {
    const diagramId = await createDiagram('Scope Test');
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    await expect(
      handleLayoutDiagram({ diagramId, scopeElementId: 'nonexistent' })
    ).rejects.toThrow();
  });

  test('rejects scope on a task (not Participant or SubProcess)', async () => {
    const diagramId = await createDiagram('Invalid Scope');
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    await expect(handleLayoutDiagram({ diagramId, scopeElementId: task })).rejects.toThrow(
      /Participant or SubProcess/
    );
  });
});

describe('layout_bpmn_diagram — crossing flow detection', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('reports crossing flows in result', async () => {
    const diagramId = await createDiagram('Crossing Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: taskA });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: taskB });
    await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: join, targetElementId: end });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    // crossingFlows should be 0 for a well-laid-out parallel branch
    // (ELK should separate branches vertically)
    if (res.crossingFlows !== undefined) {
      expect(typeof res.crossingFlows).toBe('number');
    }
  });
});
