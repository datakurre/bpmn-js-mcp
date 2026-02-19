/**
 * Tests for self-loop sequence flow routing (I1).
 *
 * Verifies that sequence flows where source === target (a task connected
 * to itself) are routed with a clean rectangular path rather than
 * collapsing to zero-length waypoints.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('self-loop routing', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('routes a self-loop on a service task as a rectangular path', async () => {
    const diagramId = await createDiagram('Self-Loop Basic');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Retry Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    const selfLoop = await connect(diagramId, task, task, { label: 'retry' });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const loopConn = reg.get(selfLoop);
    const taskEl = reg.get(task);

    expect(loopConn).toBeDefined();
    expect(loopConn.waypoints).toBeDefined();
    // Self-loop should have at least 3 waypoints (not just a degenerate 0-length path)
    expect(loopConn.waypoints.length).toBeGreaterThanOrEqual(3);

    const taskRight = taskEl.x + (taskEl.width || 100);
    const taskBottom = taskEl.y + (taskEl.height || 80);

    // At least one waypoint should extend outside the task's bounding box
    const hasExternalWaypoint = loopConn.waypoints.some(
      (wp: { x: number; y: number }) => wp.x > taskRight + 1 || wp.y > taskBottom + 1
    );
    expect(
      hasExternalWaypoint,
      'Self-loop should have at least one waypoint outside the task boundary'
    ).toBe(true);
  });

  test('routes a self-loop on a user task', async () => {
    const diagramId = await createDiagram('Self-Loop UserTask');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    const selfLoop = await connect(diagramId, task, task);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const loopConn = reg.get(selfLoop);

    expect(loopConn).toBeDefined();
    expect(loopConn.waypoints).toBeDefined();
    expect(loopConn.waypoints.length).toBeGreaterThanOrEqual(3);
  });

  test('self-loop waypoints form a valid orthogonal path (no diagonal segments)', async () => {
    const diagramId = await createDiagram('Self-Loop Orthogonal');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Poll' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    const selfLoop = await connect(diagramId, task, task, { label: 'poll again' });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const loopConn = reg.get(selfLoop);

    expect(loopConn.waypoints).toBeDefined();
    const wps: Array<{ x: number; y: number }> = loopConn.waypoints;

    // Each consecutive segment must be either horizontal or vertical (orthogonal)
    for (let i = 0; i < wps.length - 1; i++) {
      const dx = Math.abs(wps[i + 1].x - wps[i].x);
      const dy = Math.abs(wps[i + 1].y - wps[i].y);
      // At least one of dx or dy must be very small (orthogonal segment)
      expect(
        Math.min(dx, dy),
        `Segment ${i}→${i + 1} is diagonal (dx=${dx}, dy=${dy})`
      ).toBeLessThanOrEqual(2);
    }
  });

  test('self-loop does not interfere with normal forward flows', async () => {
    const diagramId = await createDiagram('Self-Loop Non-Interference');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);
    await connect(diagramId, t1, t1, { label: 'retry' }); // self-loop on t1

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // The main flow should still be left-to-right
    const startEl = reg.get(start);
    const t1El = reg.get(t1);
    const t2El = reg.get(t2);
    const endEl = reg.get(end);

    expect(startEl.x).toBeLessThan(t1El.x);
    expect(t1El.x).toBeLessThan(t2El.x);
    expect(t2El.x).toBeLessThan(endEl.x);
  });

  test('multiple self-loops on different tasks are all routed', async () => {
    const diagramId = await createDiagram('Multiple Self-Loops');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Poll A' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Poll B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);
    const loop1 = await connect(diagramId, t1, t1, { label: 'retry A' });
    const loop2 = await connect(diagramId, t2, t2, { label: 'retry B' });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    for (const loopId of [loop1, loop2]) {
      const loopConn = reg.get(loopId);
      expect(loopConn).toBeDefined();
      expect(loopConn.waypoints).toBeDefined();
      expect(loopConn.waypoints.length).toBeGreaterThanOrEqual(3);
    }
  });
});
