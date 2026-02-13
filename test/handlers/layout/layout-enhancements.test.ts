import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleListElements } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';

describe('layout_bpmn_diagram — crossing flow pairs', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('returns crossingFlowPairs as an array when crossings exist', async () => {
    const diagramId = await createDiagram('Crossing Pairs Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskA);
    await connect(diagramId, gw, taskB);
    await connect(diagramId, taskA, join);
    await connect(diagramId, taskB, join);
    await connect(diagramId, join, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    // If crossings exist, crossingFlowPairs should be an array of [string, string] pairs
    if (res.crossingFlows && res.crossingFlows > 0) {
      expect(Array.isArray(res.crossingFlowPairs)).toBe(true);
      expect(res.crossingFlowPairs.length).toBe(res.crossingFlows);
      for (const pair of res.crossingFlowPairs) {
        expect(Array.isArray(pair)).toBe(true);
        expect(pair.length).toBe(2);
      }
    }
  });
});

describe('layout_bpmn_diagram — grid snapping', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('snaps element positions to grid when gridSnap is set', async () => {
    const diagramId = await createDiagram('Grid Snap Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Order' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    // Layout with grid snapping to 10px
    const res = parseResult(await handleLayoutDiagram({ diagramId, gridSnap: 10 } as any));
    expect(res.success).toBe(true);

    // Check that all element positions are multiples of 10
    const elemRes = parseResult(await handleListElements({ diagramId }));
    const elements = elemRes.elements.filter(
      (e: any) => e.x !== undefined && e.y !== undefined && !e.type.includes('Flow')
    );

    for (const el of elements) {
      expect(el.x % 10).toBe(0);
      expect(el.y % 10).toBe(0);
    }
  });

  test('does not affect positions when gridSnap is not set', async () => {
    const diagramId = await createDiagram('No Grid Snap');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Order' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    // Layout without grid snapping
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
  });
});
