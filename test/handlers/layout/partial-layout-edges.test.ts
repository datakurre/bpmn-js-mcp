/**
 * Tests for partial layout connecting edges.
 *
 * Verifies that when running layout on a subset of elements (elementIds),
 * edges connecting the subset to external neighbors are rebuilt so they
 * still connect properly to element boundaries.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect, parseResult } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('partial layout — neighbor edge rebuild', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('rebuilds edges to neighbors after partial layout', async () => {
    // Build: Start → T1 → T2 → T3 → End
    // Layout subset: [T2] only
    // Edges T1→T2 and T2→T3 should be rebuilt to connect properly
    const diagramId = await createDiagram('Partial Layout Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 3' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, t1);
    const flow12 = await connect(diagramId, t1, t2);
    const flow23 = await connect(diagramId, t2, t3);
    await connect(diagramId, t3, end);

    // First, full layout to position everything
    await handleLayoutDiagram({ diagramId });

    // Record T2's original position
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const _t2El = reg.get(t2);

    // Now run partial layout on just T2 (this won't move much, but tests the edge rebuild)
    const result = parseResult(await handleLayoutDiagram({ diagramId, elementIds: [t2] }));
    expect(result.success).toBe(true);

    // Verify edges connecting T2 to neighbors still have valid waypoints
    const flow12El = reg.get(flow12);
    const flow23El = reg.get(flow23);

    if (flow12El?.waypoints) {
      expect(flow12El.waypoints.length).toBeGreaterThanOrEqual(2);
      // Last waypoint should be near T2's left edge
      const lastWp = flow12El.waypoints[flow12El.waypoints.length - 1];
      const t2Left = reg.get(t2).x;
      expect(Math.abs(lastWp.x - t2Left)).toBeLessThanOrEqual(20);
    }

    if (flow23El?.waypoints) {
      expect(flow23El.waypoints.length).toBeGreaterThanOrEqual(2);
      // First waypoint should be near T2's right edge
      const firstWp = flow23El.waypoints[0];
      const t2Right = reg.get(t2).x + (reg.get(t2).width || 0);
      expect(Math.abs(firstWp.x - t2Right)).toBeLessThanOrEqual(20);
    }
  });

  test('partial layout on multiple elements preserves inter-element edges', async () => {
    // Build: Start → T1 → T2 → T3 → End
    // Layout subset: [T1, T2] — edge between them should be clean
    const diagramId = await createDiagram('Partial Multi Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task C' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, t3);
    await connect(diagramId, t3, end);

    // Full layout first
    await handleLayoutDiagram({ diagramId });

    // Partial layout on T1 and T2
    const result = parseResult(await handleLayoutDiagram({ diagramId, elementIds: [t1, t2] }));
    expect(result.success).toBe(true);

    // Check all sequence flows have at least 2 waypoints
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const flows = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow' && el.waypoints);

    for (const flow of flows) {
      expect(
        flow.waypoints.length,
        `Flow ${flow.id} should have ≥2 waypoints`
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
