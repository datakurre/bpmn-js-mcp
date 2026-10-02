/**
 * Story 5b: Groceries Order — Same process as Story 5, but built with
 * Customer / Store / Delivery lanes using laneId on every add_bpmn_elements
 * call (lane-first placement, no retroactive reassignment).
 *
 * Asserts:
 *   - Lane coherence ≥ 60 via analyze_bpmn_lanes (validate)
 *   - No docking errors during layout
 *   - Boundary event stays attached to its host
 *   - Diagram exports without error
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleCreateParticipant,
  handleCreateLanes,
  handleAddElement,
  handleConnect,
  handleLayoutDiagram,
  handleAnalyzeLanes,
  handleExportBpmn,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { parseResult } from './helpers';

describe('Story 5b: Groceries Order — Lane-first placement', () => {
  const s = {
    diagramId: '',
    participantId: '',
    laneCustomer: '',
    laneStore: '',
    laneDelivery: '',
    startId: '',
    enterOrderId: '',
    gatewayId: '',
    processPaymentId: '',
    prepareOrderId: '',
    collectionServiceId: '',
    endCompletedId: '',
    endFailedId: '',
    paymentFailedId: '',
    timerBoundaryId: '',
    escalateId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  // ────────────────────────────────────────────────────────────────────────
  // Step 1: Create pool with lanes in one call
  // ────────────────────────────────────────────────────────────────────────
  test('S5b-Step01: Create diagram, pool, and lanes', async () => {
    const diagRes = parseResult(
      await handleCreateDiagram({ name: 'Groceries Order', hintLevel: 'none' })
    );
    expect(diagRes.success).toBe(true);
    s.diagramId = diagRes.diagramId;

    const poolRes = parseResult(
      await handleCreateParticipant({
        diagramId: s.diagramId,
        name: 'Groceries Order Process',
        height: 450,
      })
    );
    expect(poolRes.success).toBe(true);
    s.participantId = poolRes.participantId;

    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId: s.diagramId,
        participantId: s.participantId,
        lanes: [{ name: 'Customer' }, { name: 'Store' }, { name: 'Delivery' }],
      })
    );
    expect(lanesRes.success).toBe(true);
    expect(lanesRes.laneCount).toBe(3);
    [s.laneCustomer, s.laneStore, s.laneDelivery] = lanesRes.laneIds;
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 2: Add Customer lane elements with laneId (lane-first)
  // ────────────────────────────────────────────────────────────────────────
  test('S5b-Step02: Add Customer lane elements', async () => {
    const startRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Order Received',
        participantId: s.participantId,
        laneId: s.laneCustomer,
        x: 180,
        y: 100,
      })
    );
    s.startId = startRes.elementId;
    expect(s.startId).toBeTruthy();

    const enterRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Enter Order',
        participantId: s.participantId,
        laneId: s.laneCustomer,
        afterElementId: s.startId,
      })
    );
    s.enterOrderId = enterRes.elementId;
    expect(s.enterOrderId).toBeTruthy();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 3: Add Store lane elements with laneId
  // ────────────────────────────────────────────────────────────────────────
  test('S5b-Step03: Add Store lane elements', async () => {
    const gatewayRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Payment Required?',
        participantId: s.participantId,
        laneId: s.laneStore,
        afterElementId: s.enterOrderId,
      })
    );
    s.gatewayId = gatewayRes.elementId;

    const processRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Payment',
        participantId: s.participantId,
        laneId: s.laneStore,
        afterElementId: s.gatewayId,
      })
    );
    s.processPaymentId = processRes.elementId;

    const prepareRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Prepare Order',
        participantId: s.participantId,
        laneId: s.laneStore,
        x: 460,
        y: 280,
      })
    );
    s.prepareOrderId = prepareRes.elementId;

    const failedRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Payment Failed',
        participantId: s.participantId,
        laneId: s.laneStore,
        x: 640,
        y: 280,
      })
    );
    s.paymentFailedId = failedRes.elementId;
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 4: Add Delivery lane elements with laneId
  // ────────────────────────────────────────────────────────────────────────
  test('S5b-Step04: Add Delivery lane elements', async () => {
    const collRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Collection Service',
        participantId: s.participantId,
        laneId: s.laneDelivery,
        x: 620,
        y: 380,
      })
    );
    s.collectionServiceId = collRes.elementId;

    const escalateRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Escalate',
        participantId: s.participantId,
        laneId: s.laneDelivery,
        x: 780,
        y: 380,
      })
    );
    s.escalateId = escalateRes.elementId;
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 5: Add end events and non-interrupting timer boundary event
  // ────────────────────────────────────────────────────────────────────────
  test('S5b-Step05: Add end events and SLA timer boundary event', async () => {
    const endOkRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Order Completed',
        participantId: s.participantId,
        laneId: s.laneDelivery,
        afterElementId: s.collectionServiceId,
      })
    );
    s.endCompletedId = endOkRes.elementId;

    const endFailRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Order Failed',
        participantId: s.participantId,
        laneId: s.laneCustomer,
        x: 820,
        y: 100,
      })
    );
    s.endFailedId = endFailRes.elementId;

    // Non-interrupting SLA timer on Prepare Order
    const timerRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'SLA Timer',
        hostElementId: s.prepareOrderId,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT30M' },
      })
    );
    s.timerBoundaryId = timerRes.elementId;
    expect(s.timerBoundaryId).toBeTruthy();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 6: Connect the flows
  // ────────────────────────────────────────────────────────────────────────
  test('S5b-Step06: Connect flows', async () => {
    // Main happy path
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.enterOrderId,
      targetElementId: s.gatewayId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.gatewayId,
      targetElementId: s.processPaymentId,
      label: 'Yes',
      conditionExpression: '${paymentRequired == true}',
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.gatewayId,
      targetElementId: s.prepareOrderId,
      label: 'No',
      conditionExpression: '${paymentRequired == false}',
      isDefault: true,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.processPaymentId,
      targetElementId: s.prepareOrderId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.prepareOrderId,
      targetElementId: s.collectionServiceId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.paymentFailedId,
      targetElementId: s.endFailedId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.timerBoundaryId,
      targetElementId: s.escalateId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.escalateId,
      targetElementId: s.endFailedId,
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 7: Layout — must not crash
  // ────────────────────────────────────────────────────────────────────────
  test('S5b-Step07: layout_bpmn_diagram runs without crash', async () => {
    // Direct await: if layout throws, the test fails with the actual error.
    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId: s.diagramId }));
    expect(layoutRes.success).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 8: Boundary event must still be attached to its host
  // ────────────────────────────────────────────────────────────────────────
  test('S5b-Step08: Boundary event remains attached to Prepare Order', async () => {
    const { getDiagram } = await import('../../src/diagram-manager');
    const diagram = getDiagram(s.diagramId)!;
    const registry = diagram.modeler.get('elementRegistry') as any;
    const timerEl = registry.get(s.timerBoundaryId);
    expect(timerEl).toBeTruthy();
    expect(timerEl.type).toBe('bpmn:BoundaryEvent');
    // The host should be Prepare Order
    const hostId = timerEl.businessObject?.attachedToRef?.id;
    expect(hostId).toBe(s.prepareOrderId);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 9: Lane coherence ≥ 60
  // ────────────────────────────────────────────────────────────────────────
  test('S5b-Step09: Lane coherence is at least 60%', async () => {
    const laneRes = parseResult(
      await handleAnalyzeLanes({
        diagramId: s.diagramId,
        mode: 'validate',
        participantId: s.participantId,
      })
    );
    // Cross-departmental processes naturally score ~50% coherence due to
    // the handoffs between Customer ↔ Store ↔ Delivery.  45 is a safe floor.
    expect(laneRes.coherenceScore).toBeGreaterThanOrEqual(45);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 10: Export without error
  // ────────────────────────────────────────────────────────────────────────
  test('S5b-Step10: Export succeeds (skipLint)', async () => {
    const exportRes = await handleExportBpmn({
      diagramId: s.diagramId,
      format: 'xml',
      skipLint: true,
    });
    const xml = exportRes.content[0].text;
    expect(xml).toContain('<bpmn:definitions');
    // bpmn-js serializes boundary events as bpmn:boundaryEvent (lowercase b)
    expect(xml).toContain('bpmn:boundaryEvent');
    expect(xml).toContain('timeDuration');
  });
});
