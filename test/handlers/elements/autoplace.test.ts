/**
 * Tests for stable single-element addition with branch-aware placement (C2-3/C2-6).
 *
 * Verifies that adding a new element after a gateway that already has an
 * outgoing branch places the new element BELOW the existing branch (not
 * on top of it), and that the existing branch elements are NOT displaced
 * horizontally by the BFS downstream shift.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('C2-3/C2-6: branch-aware placement for afterElementId', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('C2-6: adding after a gateway with one branch places new element below existing branch', async () => {
    // Build: Start → Gateway → Task1 (existing branch)
    const diagramId = await createDiagram('C2-6 Gateway');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Decision',
      afterElementId: start,
    });
    await connect(diagramId, start, gw);

    // Place Task1 (existing branch) at a fixed position after the gateway
    const task1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task1',
      afterElementId: gw,
    });
    await connect(diagramId, gw, task1);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const task1El = reg.get(task1);
    const gwEl = reg.get(gw);

    // Record Task1 position before adding the second branch (y matters for the assertion)
    const task1yBefore = task1El.y;

    // Add Task2 after the gateway — should be placed on a new branch below Task1
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task2',
        afterElementId: gw,
        autoConnect: false, // don't auto-connect; we're testing positioning only
      })
    );

    expect(result.elementId).toBeDefined();
    const task2Id = result.elementId as string;
    const task2El = reg.get(task2Id);
    expect(task2El).toBeDefined();

    // Task2 must be at the same X as the gateway's right-edge + gap
    const gwRight = gwEl.x + (gwEl.width || 50);
    expect(task2El.x).toBeGreaterThanOrEqual(gwRight);

    // Task2 must be BELOW Task1 (not overlapping vertically)
    const task1Bottom = task1yBefore + (task1El.height ?? 80);
    expect(task2El.y).toBeGreaterThan(task1Bottom - 1);
  });

  test('C2-2: adding after a leaf task with downstream connection uses BFS shifting only for reachable elements', async () => {
    // Build a branched diagram:
    //   GW → [Branch A: A1 → A2] and [Branch B: B1]
    // Then add an element after A1 — only A2 should shift, not B1
    const diagramId = await createDiagram('C2-2 BFS');
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'GW' });
    const a1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'A1',
      x: 350,
      y: 100,
    });
    const a2 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'A2',
      x: 500,
      y: 100,
    });
    const b1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'B1',
      x: 500,
      y: 250,
    });

    await connect(diagramId, gw, a1);
    await connect(diagramId, a1, a2);
    await connect(diagramId, gw, b1);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const b1xBefore = reg.get(b1).x;

    // Add NewTask after A1 (should shift A2 but not B1)
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'NewTask',
        afterElementId: a1,
      })
    );
    expect(result.elementId).toBeDefined();

    // B1 must not have been shifted (it's on Branch B, not reachable from A1)
    const b1xAfter = reg.get(b1).x;
    expect(Math.abs(b1xAfter - b1xBefore)).toBeLessThan(10);

    // A2 should have shifted right to make room for NewTask
    const a2xAfter = reg.get(a2).x;
    expect(a2xAfter).toBeGreaterThan(500);
  });

  test('C2-4: auto-created connection after afterElementId has orthogonal waypoints', async () => {
    // Build a simple linear process and verify the auto-created connection
    // gets clean horizontal waypoints
    const diagramId = await createDiagram('C2-4 Waypoints');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'My Task',
      afterElementId: start,
    });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const taskEl = reg.get(taskId);

    // Find the auto-created connection
    const allConns = reg
      .getAll()
      .filter(
        (el: any) =>
          el.type === 'bpmn:SequenceFlow' && el.source?.id === start && el.target?.id === taskId
      );
    expect(allConns).toHaveLength(1);

    const conn = allConns[0] as any;
    const wps = conn.waypoints as Array<{ x: number; y: number }>;
    expect(wps).toBeDefined();
    expect(wps.length).toBeGreaterThanOrEqual(2);

    // For a straight horizontal route, all waypoints should be at the same Y
    const startCy = startEl.y + (startEl.height || 0) / 2;
    const taskCy = taskEl.y + (taskEl.height || 0) / 2;
    const sameCy = Math.abs(startCy - taskCy) <= 15;
    if (sameCy) {
      // All waypoints should have the same Y (straight horizontal route)
      const firstY = wps[0].y;
      for (const wp of wps) {
        expect(Math.abs(wp.y - firstY)).toBeLessThan(5);
      }
    }

    // First waypoint should be at/near source right edge
    const srcRight = startEl.x + (startEl.width || 0);
    expect(Math.abs(wps[0].x - srcRight)).toBeLessThan(5);

    // Last waypoint should be at/near target left edge
    const tgtLeft = taskEl.x;
    expect(Math.abs(wps[wps.length - 1].x - tgtLeft)).toBeLessThan(5);
  });
});
