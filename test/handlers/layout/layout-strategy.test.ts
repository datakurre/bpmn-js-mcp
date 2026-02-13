import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  connect,
  clearDiagrams,
  getRegistry,
} from '../../helpers';

describe('layout_bpmn_diagram layoutStrategy', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('deterministic layout arranges a linear chain left-to-right', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, end);

    const res = parseResult(
      await handleLayoutDiagram({ diagramId, layoutStrategy: 'deterministic' })
    );

    expect(res.success).toBe(true);
    expect(res.layoutStrategy).toBe('deterministic');

    // Elements should be arranged left-to-right
    const registry = getRegistry(diagramId);
    const startEl = registry.get(start);
    const task1El = registry.get(task1);
    const task2El = registry.get(task2);
    const endEl = registry.get(end);

    expect(task1El.x).toBeGreaterThan(startEl.x);
    expect(task2El.x).toBeGreaterThan(task1El.x);
    expect(endEl.x).toBeGreaterThan(task2El.x);

    // All should share approximately the same Y (linear chain)
    const ys = [startEl.y, task1El.y, task2El.y, endEl.y];
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
    for (const y of ys) {
      expect(Math.abs(y - avgY)).toBeLessThan(50);
    }
  });

  test('deterministic layout falls back to full for complex diagrams', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw1 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'GW1' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T1' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T2' });
    const gw2 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'GW2' });
    const task3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T3' });
    const gw3 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'GW3' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, gw1);
    await connect(diagramId, gw1, task1);
    await connect(diagramId, gw1, task2);
    await connect(diagramId, task1, gw2);
    await connect(diagramId, task2, gw2);
    await connect(diagramId, gw2, task3);
    await connect(diagramId, task3, gw3);
    await connect(diagramId, gw3, gw1); // loop back - makes it non-trivial
    await connect(diagramId, gw3, end);

    const res = parseResult(
      await handleLayoutDiagram({ diagramId, layoutStrategy: 'deterministic' })
    );

    expect(res.success).toBe(true);
    // Should fall back to full ELK, no deterministic flag
    expect(res.layoutStrategy).toBeUndefined();
  });

  test('laneStrategy parameter is accepted', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const res = parseResult(await handleLayoutDiagram({ diagramId, laneStrategy: 'preserve' }));
    expect(res.success).toBe(true);
  });
});
