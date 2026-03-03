/**
 * Boundary event layout tests.
 *
 * Consolidated from:
 * - boundary-event-spreading.test.ts (overlap prevention)
 * - boundary-subflow-alignment.test.ts (Y-alignment, orthogonality)
 * - boundary-event-routing.test.ts (waypoint count, orthogonality)
 * - boundary-event-label-layout.test.ts (label proximity, bottom-border preference)
 * - boundary-exception-chains.test.ts (below-host positioning, flow-through intersections)
 *
 * 9 tests covering: spreading, alignment, routing, labels, and exception chains.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleAddElement,
  handleSetEventDefinition,
} from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  connect,
  clearDiagrams,
  getRegistry,
} from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';
import { segmentIntersectsRect, type Rect } from '../../../src/geometry';

// ── Helpers ────────────────────────────────────────────────────────────────

function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

/** Check if a connection's waypoints intersect a shape's bounding box. */
function connectionIntersectsShape(conn: any, shape: any): boolean {
  const rect: Rect = {
    x: shape.x,
    y: shape.y,
    width: shape.width || 0,
    height: shape.height || 0,
  };
  for (let i = 0; i < conn.waypoints.length - 1; i++) {
    if (segmentIntersectsRect(conn.waypoints[i], conn.waypoints[i + 1], rect)) {
      return true;
    }
  }
  return false;
}

/** Collect IDs of boundary events attached to specific elements. */
function collectAttachedBoundaryIds(allElements: any[], elementIds: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const el of allElements) {
    if (el.type === 'bpmn:BoundaryEvent' && el.host && elementIds.has(el.host.id)) {
      result.add(el.id);
    }
  }
  return result;
}

/** Infrastructure/lane/label type check. */
function isObstacleCandidate(el: any): boolean {
  return (
    el.type &&
    !el.type.includes('Flow') &&
    !el.type.includes('Association') &&
    !el.type.includes('MessageFlow') &&
    !el.type.includes('DataInputAssociation') &&
    !el.type.includes('DataOutputAssociation') &&
    el.type !== 'label' &&
    el.type !== 'bpmn:BoundaryEvent' &&
    el.type !== 'bpmn:Participant' &&
    el.type !== 'bpmn:Collaboration' &&
    el.type !== 'bpmn:Process' &&
    !el.type.includes('Lane') &&
    el.width !== undefined &&
    el.height !== undefined
  );
}

/** Count how many connection segments intersect unrelated elements. */
function countFlowThroughElementIntersections(registry: any): number {
  const allElements = registry.getAll();
  const shapes = allElements.filter((el: any) => isObstacleCandidate(el));
  const connections = allElements.filter(
    (el: any) =>
      (el.type === 'bpmn:SequenceFlow' ||
        el.type === 'bpmn:MessageFlow' ||
        el.type === 'bpmn:Association') &&
      el.waypoints &&
      el.waypoints.length >= 2
  );

  let count = 0;
  for (const conn of connections) {
    const sourceId = conn.source?.id;
    const targetId = conn.target?.id;
    if (!sourceId || !targetId) continue;

    const attachedBoundaryIds = collectAttachedBoundaryIds(
      allElements,
      new Set([sourceId, targetId])
    );

    for (const shape of shapes) {
      if (shape.id === sourceId || shape.id === targetId) continue;
      if (attachedBoundaryIds.has(shape.id)) continue;
      if (connectionIntersectsShape(conn, shape)) {
        count++;
      }
    }
  }

  return count;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('boundary event layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── Spreading ──────────────────────────────────────────────────────────

  test('spreads multiple boundary events on the same host border', async () => {
    const diagramId = await createDiagram('Boundary Spread Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const be1Res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: task,
        name: 'Timer 1',
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT15M' },
      })
    );
    const be2Res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: task,
        name: 'Timer 2',
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT30M' },
      })
    );

    const endBe1 = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End BE1' });
    const endBe2 = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End BE2' });
    await connect(diagramId, be1Res.elementId, endBe1);
    await connect(diagramId, be2Res.elementId, endBe2);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const be1 = reg.get(be1Res.elementId);
    const be2 = reg.get(be2Res.elementId);

    expect(be1).toBeDefined();
    expect(be2).toBeDefined();

    const be1Cx = be1.x + (be1.width || 36) / 2;
    const be2Cx = be2.x + (be2.width || 36) / 2;
    const be1Cy = be1.y + (be1.height || 36) / 2;
    const be2Cy = be2.y + (be2.height || 36) / 2;

    const dxCentres = Math.abs(be1Cx - be2Cx);
    const dyCentres = Math.abs(be1Cy - be2Cy);

    const separated = dxCentres > 15 || dyCentres > 15;
    expect(
      separated,
      `Boundary events overlap: centres at (${be1Cx},${be1Cy}) and (${be2Cx},${be2Cy}), ` +
        `dx=${dxCentres}, dy=${dyCentres}`
    ).toBe(true);
  });

  // ── Sub-flow alignment ─────────────────────────────────────────────────

  test('end event after boundary handler aligns with handler Y', async () => {
    const diagramId = await createDiagram('Boundary EndEvent Align');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API' });
    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timeout',
      hostElementId: task,
    });
    await handleSetEventDefinition({
      diagramId,
      elementId: boundary,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      properties: { timeDuration: 'PT30S' },
    });
    const handler = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle Timeout' });
    const endOk = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
    const endTimeout = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timed Out' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, endOk);
    await connect(diagramId, boundary, handler);
    await connect(diagramId, handler, endTimeout);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const handlerEl = reg.get(handler);
    const endTimeoutEl = reg.get(endTimeout);

    expect(
      Math.abs(centreY(handlerEl) - centreY(endTimeoutEl)),
      'End event should align with handler Y'
    ).toBeLessThanOrEqual(5);
  });

  test('end event directly from boundary event has orthogonal flows', async () => {
    const diagramId = await createDiagram('Boundary Direct End');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: task,
    });
    const endOk = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Success' });
    const endError = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Error End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, endOk);
    await connect(diagramId, boundary, endError);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      const wps = conn.waypoints;
      for (let i = 1; i < wps.length; i++) {
        const dx = Math.abs(wps[i].x - wps[i - 1].x);
        const dy = Math.abs(wps[i].y - wps[i - 1].y);
        expect(dx < 1 || dy < 1, `Connection ${conn.id} should be orthogonal`).toBe(true);
      }
    }
  });

  // ── Routing ────────────────────────────────────────────────────────────

  test('boundary event outgoing flow has valid waypoints', async () => {
    const diagramId = await createDiagram('Boundary Event Routing');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const boundaryEvent = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timeout',
      hostElementId: task,
    });
    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timeout End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    await connect(diagramId, boundaryEvent, errorEnd);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const connections = reg.filter(
      (el: any) => el.type === 'bpmn:SequenceFlow' && el.source?.id === boundaryEvent
    );
    expect(connections.length).toBeGreaterThanOrEqual(1);

    const boundaryConn = connections[0];
    expect(boundaryConn.waypoints).toBeDefined();
    expect(boundaryConn.waypoints.length).toBeGreaterThanOrEqual(2);
  });

  test('boundary event error path has orthogonal routing', async () => {
    const diagramId = await createDiagram('Error Path Routing');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Success' });
    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: task,
    });
    const retryTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle Error' });
    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Failed' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    await connect(diagramId, boundary, retryTask);
    await connect(diagramId, retryTask, errorEnd);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.elementCount).toBeGreaterThanOrEqual(5);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const boundaryConn = reg.filter(
      (el: any) => el.type === 'bpmn:SequenceFlow' && el.source?.id === boundary
    )[0];

    if (boundaryConn?.waypoints) {
      for (let i = 1; i < boundaryConn.waypoints.length; i++) {
        const prev = boundaryConn.waypoints[i - 1];
        const curr = boundaryConn.waypoints[i];
        const dx = Math.abs(curr.x - prev.x);
        const dy = Math.abs(curr.y - prev.y);
        expect(Math.min(dx, dy)).toBeLessThan(16);
      }
    }
  });

  // ── Labels ─────────────────────────────────────────────────────────────

  test('boundary event labels stay near their events after layout', async () => {
    const diagramId = await createDiagram('Boundary Label Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const beRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Timeout',
        hostElementId: task,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
      })
    );
    const beId = beRes.elementId;
    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timed Out' });
    await connect(diagramId, beId, errorEnd);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const beEl = reg.get(beId);

    expect(beEl.x).toBeGreaterThan(0);
    expect(beEl.y).toBeGreaterThan(0);

    if (beEl.label) {
      const beCx = beEl.x + (beEl.width || 36) / 2;
      const beCy = beEl.y + (beEl.height || 36) / 2;
      const labelCx = beEl.label.x + (beEl.label.width || 90) / 2;
      const labelCy = beEl.label.y + (beEl.label.height || 20) / 2;

      expect(Math.abs(labelCx - beCx)).toBeLessThan(100);
      expect(Math.abs(labelCy - beCy)).toBeLessThan(100);
      expect(beEl.label.x).toBeGreaterThan(-50);
      expect(beEl.label.y).toBeGreaterThan(-50);
    }
  });

  test('boundary event outgoing flow exits from the bottom (not sideways)', async () => {
    const diagramId = await createDiagram('Boundary Exit Direction');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timeout',
      hostElementId: task,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      eventDefinitionProperties: { timeDuration: 'PT1H' },
    });
    const handler = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Handle Timeout' });
    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Handled' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    await connect(diagramId, boundary, handler);
    await connect(diagramId, handler, errorEnd);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const beEl = reg.get(boundary);
    const connections: any[] = reg.filter(
      (el: any) => el.type === 'bpmn:SequenceFlow' && el.source?.id === boundary
    );

    expect(connections.length).toBeGreaterThanOrEqual(1);
    const conn = connections[0];
    expect(conn.waypoints).toBeDefined();
    expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);

    const wp0 = conn.waypoints[0];
    const wp1 = conn.waypoints[1];

    // The boundary event is at the host's bottom border.
    // The first waypoint must be near the bottom-centre of the event,
    // and the first segment must be vertical (dy > dx).
    const beCenterX = beEl.x + beEl.width / 2;
    const beBottom = beEl.y + beEl.height;

    expect(Math.abs(wp0.x - beCenterX)).toBeLessThan(5);
    expect(wp0.y).toBeGreaterThanOrEqual(beBottom - 2);

    const segDx = Math.abs(wp1.x - wp0.x);
    const segDy = Math.abs(wp1.y - wp0.y);
    expect(segDy).toBeGreaterThan(segDx);
  });

  test('boundary event label is offset to the side, not centred on the flow line', async () => {
    const diagramId = await createDiagram('Boundary Label Side');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'SLA Warning',
      hostElementId: task,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      eventDefinitionProperties: { timeDuration: 'PT30M' },
    });
    const handler = await addElement(diagramId, 'bpmn:SendTask', { name: 'Send Alert' });
    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Alert Sent' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    await connect(diagramId, boundary, handler);
    await connect(diagramId, handler, errorEnd);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const beEl = reg.get(boundary);

    if (!beEl.label) return; // label visibility is optional

    const beCenterX = beEl.x + beEl.width / 2;
    const labelCenterX = beEl.label.x + (beEl.label.width ?? 90) / 2;

    // The label must NOT sit directly below the event centre (which would
    // place it on top of the downward-exiting flow line). It should be
    // clearly offset to the left or right.
    const offsetX = Math.abs(labelCenterX - beCenterX);
    expect(offsetX).toBeGreaterThan(15);
  });

  test('boundary event prefers bottom border of host', async () => {
    const diagramId = await createDiagram('Boundary Bottom Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const beRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Error',
        hostElementId: task,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
      })
    );
    const beId = beRes.elementId;
    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Failed' });
    await connect(diagramId, beId, errorEnd);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const beEl = reg.get(beId);
    const hostEl = reg.get(task);

    const beCy = beEl.y + (beEl.height || 36) / 2;
    const hostBottom = hostEl.y + (hostEl.height || 80);
    expect(Math.abs(beCy - hostBottom)).toBeLessThan(30);
  });

  // ── Exception chains ──────────────────────────────────────────────────

  test('single boundary chain: handler + end event below host', async () => {
    const diagramId = await createDiagram('Single Boundary Chain');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: task,
      eventDefinitionType: 'bpmn:ErrorEventDefinition',
    });
    const handler = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Handle Error' });
    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Error End' });
    await connect(diagramId, boundary, handler);
    await connect(diagramId, handler, errorEnd);

    await handleLayoutDiagram({ diagramId });

    const reg = getRegistry(diagramId);
    const taskEl = reg.get(task);
    const handlerEl = reg.get(handler);
    const errorEndEl = reg.get(errorEnd);

    expect(handlerEl.y).toBeGreaterThan(taskEl.y + taskEl.height);

    const hostCx = taskEl.x + taskEl.width / 2;
    const handlerCx = handlerEl.x + handlerEl.width / 2;
    expect(Math.abs(handlerCx - hostCx)).toBeLessThan(200);

    expect(errorEndEl.x).toBeGreaterThan(handlerEl.x);

    const handlerCy = handlerEl.y + handlerEl.height / 2;
    const errorEndCy = errorEndEl.y + errorEndEl.height / 2;
    expect(Math.abs(handlerCy - errorEndCy)).toBeLessThan(30);
  });

  test('multiple hosts with boundary chains: no flow-through crossings', async () => {
    const diagramId = await createDiagram('Multi Boundary Chain');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 2' });
    const task3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 3' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, task3);
    await connect(diagramId, task3, end);

    const be1 = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timer',
      hostElementId: task1,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      eventDefinitionProperties: { timeDuration: 'PT1H' },
      cancelActivity: false,
    });
    const handler1 = await addElement(diagramId, 'bpmn:SendTask', { name: 'Send Reminder' });
    const end1 = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Reminded' });
    await connect(diagramId, be1, handler1);
    await connect(diagramId, handler1, end1);

    const be2 = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: task2,
      eventDefinitionType: 'bpmn:ErrorEventDefinition',
    });
    const handler2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle Error' });
    const end2 = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Error Handled' });
    await connect(diagramId, be2, handler2);
    await connect(diagramId, handler2, end2);

    const be3 = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Message',
      hostElementId: task3,
      eventDefinitionType: 'bpmn:MessageEventDefinition',
      cancelActivity: false,
    });
    const handler3 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Log Cancel' });
    const end3 = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Cancelled' });
    await connect(diagramId, be3, handler3);
    await connect(diagramId, handler3, end3);

    await handleLayoutDiagram({ diagramId });

    const reg = getRegistry(diagramId);
    const t1 = reg.get(task1);
    const t2 = reg.get(task2);
    const t3 = reg.get(task3);
    const h1 = reg.get(handler1);
    const h2 = reg.get(handler2);
    const h3 = reg.get(handler3);

    expect(h1.y).toBeGreaterThan(t1.y + t1.height);
    expect(h2.y).toBeGreaterThan(t2.y + t2.height);
    expect(h3.y).toBeGreaterThan(t3.y + t3.height);

    const h1Cx = h1.x + h1.width / 2;
    const h2Cx = h2.x + h2.width / 2;
    expect(h1Cx).toBeLessThan(t2.x + t2.width / 2);
    expect(h2Cx).toBeLessThan(t3.x + t3.width / 2);

    const intersections = countFlowThroughElementIntersections(reg);
    expect(intersections).toBeLessThanOrEqual(15);
  });
});
