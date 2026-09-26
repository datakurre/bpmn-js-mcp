/**
 * Regression test: `layout_bpmn_diagram` must NOT crash with
 * "unexpected dockingDirection: <undefined>" after lane reassignment.
 *
 * The crash fires when bpmn-js' ManhattanLayout repositions an element whose
 * sequence-flow connections have waypoints in an inconsistent state (e.g.
 * after elements were moved to lanes). The fix wraps the reposition call in
 * a try/catch in `assign-elements-to-lane.ts` and degrades gracefully.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateParticipant,
  handleCreateLanes,
  handleAssignElementsToLane,
  handleConnect,
  handleLayoutDiagram,
} from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('layout_bpmn_diagram — docking crash guard after lane assignment', () => {
  beforeEach(() => clearDiagrams());

  test('does not crash when laying out a diagram after elements are moved to lanes', async () => {
    const diagramId = await createDiagram();

    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Groceries', height: 400 })
    );
    const participantId = poolRes.participantId;

    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Customer' }, { name: 'Store' }, { name: 'Delivery' }],
      })
    );
    const [laneCustomer, laneStore, laneDelivery] = lanesRes.laneIds as string[];

    // Build a connected flow
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId,
      x: 150,
      y: 200,
    });
    const enterOrder = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Enter Order',
      participantId,
      x: 300,
      y: 200,
    });
    const processPayment = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Payment',
      participantId,
      x: 460,
      y: 200,
    });
    const endOk = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Order Completed',
      participantId,
      x: 640,
      y: 200,
    });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: enterOrder });
    await handleConnect({
      diagramId,
      sourceElementId: enterOrder,
      targetElementId: processPayment,
    });
    await handleConnect({ diagramId, sourceElementId: processPayment, targetElementId: endOk });

    // Retroactively assign connected elements to lanes (the crash scenario)
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneCustomer,
      elementIds: [start, enterOrder],
      reposition: true,
    });
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneStore,
      elementIds: [processPayment],
      reposition: true,
    });
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneDelivery,
      elementIds: [endOk],
      reposition: true,
    });

    // layout_bpmn_diagram must NOT throw.
    // (Direct await — if it throws, the test fails with the actual docking error.)
    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));

    expect(layoutRes.success).toBe(true);
  });
});
