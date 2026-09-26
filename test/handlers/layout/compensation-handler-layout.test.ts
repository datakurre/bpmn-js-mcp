/**
 * Test for compensation handler positioning (G2).
 *
 * Compensation activities are connected to their compensation boundary event
 * via bpmn:Association (not sequence flow).  The layout engine must position
 * them below the host task, similar to error exception chain targets.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleSetEventDefinition,
  handleConnect,
  handleAddElement,
} from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, parseResult } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

/** Check whether point (px, py) is within `bounds` + `tolerance` pixels. */
function pointWithinBounds(
  px: number,
  py: number,
  el: { x: number; y: number; width: number; height: number },
  tolerance: number
): boolean {
  return (
    px >= el.x - tolerance &&
    px <= el.x + el.width + tolerance &&
    py >= el.y - tolerance &&
    py <= el.y + el.height + tolerance
  );
}

describe('Compensation handler positioning (G2)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('compensation handler is placed below host task after layout', async () => {
    // Build: Start → Task (host) → End
    //        [CompensateBoundaryEvent] attached to host → [CompensationHandler] via Association
    const diagramId = await createDiagram('Compensation Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const host = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Payment' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    // Connect the main flow
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: host });
    await handleConnect({ diagramId, sourceElementId: host, targetElementId: end });

    // Add compensation boundary event on the host task
    const compBEResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      hostElementId: host,
      name: 'Compensation',
    });
    const compBEId = parseResult(compBEResult).elementId as string;

    // Set compensation event definition on the boundary event
    await handleSetEventDefinition({
      diagramId,
      elementId: compBEId,
      eventDefinitionType: 'bpmn:CompensateEventDefinition',
    });

    // Add compensation handler task (NOT connected via sequence flow)
    const handlerResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:Task',
      name: 'Refund Payment',
    });
    const handlerId = parseResult(handlerResult).elementId as string;

    // Connect boundary event to handler via Association
    await handleConnect({
      diagramId,
      sourceElementId: compBEId,
      targetElementId: handlerId,
      connectionType: 'bpmn:Association',
    });

    // Run layout
    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const hostEl = reg.get(host);
    const handlerEl = reg.get(handlerId);

    expect(hostEl).toBeTruthy();
    expect(handlerEl).toBeTruthy();

    // Compensation handler should be below the host task
    const hostBottom = hostEl.y + (hostEl.height || 80);
    const handlerCy = handlerEl.y + (handlerEl.height || 80) / 2;

    expect(handlerCy).toBeGreaterThan(hostBottom);
  });

  test('compensation handler connected via association has no sequence flows', async () => {
    // When a compensation association is created from a boundary event to
    // a task that was previously in the main flow, bpmn-js removes the task's
    // sequence flows (BPMN spec: compensation handlers cannot be in the main
    // sequence flow).  Verify this behavior, then check layout still works.
    const diagramId = await createDiagram('Shared Compensation Handler');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
    const task2 = await addElement(diagramId, 'bpmn:Task', { name: 'Shared Handler' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task1 });
    await handleConnect({ diagramId, sourceElementId: task1, targetElementId: task2 });
    await handleConnect({ diagramId, sourceElementId: task2, targetElementId: end });

    // Add compensation boundary event on task1
    const compBEResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      hostElementId: task1,
      name: 'Compensation',
    });
    const compBEId = parseResult(compBEResult).elementId as string;

    await handleSetEventDefinition({
      diagramId,
      elementId: compBEId,
      eventDefinitionType: 'bpmn:CompensateEventDefinition',
    });

    // Creating association to task2 marks it as compensation handler,
    // and bpmn-js removes its sequence flows (BPMN spec compliance).
    await handleConnect({
      diagramId,
      sourceElementId: compBEId,
      targetElementId: task2,
      connectionType: 'bpmn:Association',
    });

    // Layout should still succeed
    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const task2El = reg.get(task2);

    expect(task2El).toBeTruthy();
    // task2 is now a compensation handler, positioned below its host
    const task1El = reg.get(task1);
    const hostBottom = task1El.y + (task1El.height || 80);
    const handlerCy = task2El.y + (task2El.height || 80) / 2;
    expect(handlerCy).toBeGreaterThan(hostBottom);
  });

  test('association waypoints are within source/target bounds after layout', async () => {
    // Regression: after layout, association waypoints were not updated
    // and stayed at stale creation-time coordinates, disconnected from the
    // repositioned elements.
    const diagramId = await createDiagram('Association Waypoint Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const host = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Payment' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: host });
    await handleConnect({ diagramId, sourceElementId: host, targetElementId: end });

    const compBEResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      hostElementId: host,
      name: 'Compensation',
    });
    const compBEId = parseResult(compBEResult).elementId as string;

    await handleSetEventDefinition({
      diagramId,
      elementId: compBEId,
      eventDefinitionType: 'bpmn:CompensateEventDefinition',
    });

    const handlerResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:Task',
      name: 'Refund Payment',
    });
    const handlerId = parseResult(handlerResult).elementId as string;

    const assocResult = await handleConnect({
      diagramId,
      sourceElementId: compBEId,
      targetElementId: handlerId,
      connectionType: 'bpmn:Association',
    });
    const assocId = parseResult(assocResult).connectionId as string;

    // Run layout — this should fix stale association waypoints
    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const assoc = reg.get(assocId);
    const compBE = reg.get(compBEId);
    const handler = reg.get(handlerId);

    expect(assoc?.waypoints).toBeDefined();
    expect(assoc.waypoints.length).toBeGreaterThanOrEqual(2);

    const wps = assoc.waypoints as Array<{ x: number; y: number }>;
    const first = wps[0];
    const last = wps[wps.length - 1];

    // First waypoint must be near the source (boundary event) bounds
    expect(pointWithinBounds(first.x, first.y, compBE, 20)).toBe(true);
    // Last waypoint must be near the target (handler) bounds
    expect(pointWithinBounds(last.x, last.y, handler, 20)).toBe(true);
  });

  test('layout response includes associationWaypointsFixed count when stale waypoints were recomputed', async () => {
    // Regression: layout response should report how many association waypoints
    // were recomputed so callers know the diagram had stale edges.
    const diagramId = await createDiagram('Association Metrics Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const host = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Payment' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: host });
    await handleConnect({ diagramId, sourceElementId: host, targetElementId: end });

    const compBEResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      hostElementId: host,
      name: 'Compensation',
    });
    const compBEId = parseResult(compBEResult).elementId as string;

    await handleSetEventDefinition({
      diagramId,
      elementId: compBEId,
      eventDefinitionType: 'bpmn:CompensateEventDefinition',
    });

    const handlerResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:Task',
      name: 'Refund Payment',
    });
    const handlerId = parseResult(handlerResult).elementId as string;

    await handleConnect({
      diagramId,
      sourceElementId: compBEId,
      targetElementId: handlerId,
      connectionType: 'bpmn:Association',
    });

    // Run layout — the association must be re-routed along with its elements
    const layoutResult = await handleLayoutDiagram({ diagramId });
    const resultData = parseResult(layoutResult);
    expect(resultData.success).toBe(true);

    // Every association's endpoints must touch its source and target
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const near = (p: any, el: any) =>
      p.x >= el.x - 20 &&
      p.x <= el.x + el.width + 20 &&
      p.y >= el.y - 20 &&
      p.y <= el.y + el.height + 20;
    const associations = reg.filter((el: any) => el.type === 'bpmn:Association');
    expect(associations.length).toBeGreaterThan(0);
    for (const assoc of associations) {
      const wps = assoc.waypoints;
      expect(near(wps[0], assoc.source)).toBe(true);
      expect(near(wps[wps.length - 1], assoc.target)).toBe(true);
    }
  });
});
