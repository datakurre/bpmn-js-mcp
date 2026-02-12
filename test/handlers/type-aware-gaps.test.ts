/**
 * Integration test for element-type-aware gap variation (AI-8).
 *
 * Validates that gridSnapPass uses different horizontal gaps between
 * layers depending on the dominant element types in adjacent layers.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Right edge of an element (x + width). */
function rightEdge(el: any): number {
  return el.x + (el.width || 0);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Element-type-aware gap variation (AI-8)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('event→task gap is larger than task→task gap', async () => {
    // Build: StartEvent → Task1 → Task2 → Task3 → EndEvent
    const diagramId = await createDiagram('Gap Variation');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 2' });
    const task3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 3' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, task3);
    await connect(diagramId, task3, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const task1El = reg.get(task1);
    const task2El = reg.get(task2);
    const task3El = reg.get(task3);
    const endEl = reg.get(end);

    // Gap between start event and task1 (event→task)
    const eventToTaskGap = task1El.x - rightEdge(startEl);
    // Gap between task1 and task2 (task→task)
    const taskToTaskGap = task2El.x - rightEdge(task1El);
    // Gap between task3 and end event (task→event)
    const taskToEventGap = endEl.x - rightEdge(task3El);

    // Event↔Task gaps should be larger than Task→Task gaps
    expect(eventToTaskGap).toBeGreaterThan(taskToTaskGap);
    expect(taskToEventGap).toBeGreaterThan(taskToTaskGap);
  });

  test('gateway→task gap uses baseline spacing', async () => {
    // Build: Start → Gateway → Task → End
    const diagramId = await createDiagram('Gateway Gaps');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Check' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'OK?' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, gw);
    await connect(diagramId, gw, task2);
    await connect(diagramId, task2, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const task1El = reg.get(task1);
    const gwEl = reg.get(gw);
    const task2El = reg.get(task2);

    // Task→Gateway and Gateway→Task should use baseline gap (no adjustment)
    const taskToGwGap = gwEl.x - rightEdge(task1El);
    const gwToTaskGap = task2El.x - rightEdge(gwEl);

    // Both should be approximately equal (baseline gap)
    expect(Math.abs(taskToGwGap - gwToTaskGap)).toBeLessThan(15);
  });
});
