/**
 * Story 7: Event-Based Patterns — Advanced Event Types
 *
 * Covers: add_bpmn_element (EventBasedGateway, InclusiveGateway),
 * set_bpmn_event_definition (signal, escalation, conditional, link, cancel),
 * manage_bpmn_root_elements (signals), set_bpmn_form_data,
 * layout_bpmn_diagram
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElement,
  handleConnect,
  handleSetProperties,
  handleManageRootElements,
  handleLayoutDiagram,
  handleExportBpmn,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { assertStep, parseResult } from './helpers';

describe('Story 7: Event-Based Patterns — Advanced Event Types', () => {
  const s = {
    diagramId: '',
    startId: '',
    eventGwId: '',
    paymentReceivedId: '',
    paymentTimeoutId: '',
    orderCancelledId: '',
    // Inclusive gateway section
    inclusiveGwId: '',
    inclusiveJoinId: '',
    emailTaskId: '',
    smsTaskId: '',
    pushTaskId: '',
    // Signal broadcast
    broadcastThrowId: '',
    broadcastCatchId: '',
    // Escalation
    escalationTaskId: '',
    escalationBoundaryId: '',
    handleEscalationId: '',
    // Link events
    linkThrowId: '',
    linkCatchId: '',
    // Conditional
    conditionalTaskId: '',
    conditionalBoundaryId: '',
    // End events
    endId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  test('S7-Step01: Create process with event-based gateway', async () => {
    const createRes = parseResult(await handleCreateDiagram({ name: 'Event Patterns' }));
    s.diagramId = createRes.diagramId as string;

    // StartEvent → EventBasedGateway
    s.startId = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Order Placed',
      })
    ).elementId as string;

    const gwRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EventBasedGateway',
        afterElementId: s.startId,
      })
    );
    s.eventGwId = gwRes.elementId as string;

    // Branch 1: Payment Received (Message)
    const payRecvRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:IntermediateCatchEvent',
        name: 'Payment Received',
        afterElementId: s.eventGwId,
        autoConnect: false,
        eventDefinitionType: 'bpmn:MessageEventDefinition',
        messageRef: { id: 'Msg_PaymentReceived', name: 'PaymentReceived' },
      })
    );
    s.paymentReceivedId = payRecvRes.elementId as string;
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.eventGwId,
      targetElementId: s.paymentReceivedId,
    });

    // Branch 2: Payment Timeout (Timer)
    const timeoutRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:IntermediateCatchEvent',
        name: 'Payment Timeout',
        afterElementId: s.eventGwId,
        autoConnect: false,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'P3D' },
      })
    );
    s.paymentTimeoutId = timeoutRes.elementId as string;
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.eventGwId,
      targetElementId: s.paymentTimeoutId,
    });

    // Branch 3: Order Cancelled (Signal)
    const cancelRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:IntermediateCatchEvent',
        name: 'Order Cancelled',
        afterElementId: s.eventGwId,
        autoConnect: false,
        eventDefinitionType: 'bpmn:SignalEventDefinition',
        signalRef: { id: 'Signal_OrderCancelled', name: 'OrderCancelled' },
      })
    );
    s.orderCancelledId = cancelRes.elementId as string;
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.eventGwId,
      targetElementId: s.orderCancelledId,
    });

    // Each catch event → a task → end event
    // Payment Received path
    const payTaskRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Process Payment',
        afterElementId: s.paymentReceivedId,
      })
    );
    const payEnd = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Order Fulfilled',
        afterElementId: payTaskRes.elementId,
      })
    );
    s.endId = payEnd.elementId as string;

    // Payment Timeout path
    const timeoutTaskRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Handle Timeout',
        afterElementId: s.paymentTimeoutId,
      })
    );
    await handleAddElement({
      diagramId: s.diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Order Expired',
      afterElementId: timeoutTaskRes.elementId,
    });

    // Order Cancelled path
    const cancelTaskRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Process Cancellation',
        afterElementId: s.orderCancelledId,
      })
    );
    await handleAddElement({
      diagramId: s.diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Order Cancelled End',
      afterElementId: cancelTaskRes.elementId,
    });

    await assertStep(s.diagramId, 'S7-Step01', {
      containsElements: ['Order Placed', 'Payment Received', 'Payment Timeout', 'Order Cancelled'],
      snapshotFile: 'story-07/step-01.bpmn',
    });
  });

  test('S7-Step02: Add inclusive gateway pattern', async () => {
    // InclusiveGateway split
    const inclRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:InclusiveGateway',
        name: 'Select Notifications',
      })
    );
    s.inclusiveGwId = inclRes.elementId as string;

    // Email notification branch
    const emailRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Send Email',
        afterElementId: s.inclusiveGwId,
        autoConnect: false,
      })
    );
    s.emailTaskId = emailRes.elementId as string;

    // SMS notification branch
    const smsRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Send SMS',
        afterElementId: s.inclusiveGwId,
        autoConnect: false,
      })
    );
    s.smsTaskId = smsRes.elementId as string;

    // Push notification branch
    const pushRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Send Push',
        afterElementId: s.inclusiveGwId,
        autoConnect: false,
      })
    );
    s.pushTaskId = pushRes.elementId as string;

    // Join gateway
    const joinRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:InclusiveGateway',
        name: 'Notifications Done',
      })
    );
    s.inclusiveJoinId = joinRes.elementId as string;

    // Connect split gateway → branches with conditions
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.inclusiveGwId,
      targetElementId: s.emailTaskId,
      label: 'Email',
      conditionExpression: '${notifyEmail}',
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.inclusiveGwId,
      targetElementId: s.smsTaskId,
      label: 'SMS',
      conditionExpression: '${notifySms}',
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.inclusiveGwId,
      targetElementId: s.pushTaskId,
      label: 'Push',
      conditionExpression: '${notifyPush}',
    });

    // Connect branches → join
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.emailTaskId,
      targetElementId: s.inclusiveJoinId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.smsTaskId,
      targetElementId: s.inclusiveJoinId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.pushTaskId,
      targetElementId: s.inclusiveJoinId,
    });

    await assertStep(s.diagramId, 'S7-Step02', {
      containsElements: ['Select Notifications', 'Send Email', 'Send SMS', 'Send Push'],
      snapshotFile: 'story-07/step-02.bpmn',
    });
  });

  test('S7-Step03: Add signal broadcast pattern', async () => {
    // Create shared signal
    await handleManageRootElements({
      diagramId: s.diagramId,
      signals: [{ id: 'Signal_OrderCompleted', name: 'OrderCompleted' }],
    });

    // IntermediateThrowEvent (Broadcast)
    const throwRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:IntermediateThrowEvent',
        name: 'Broadcast Completion',
        eventDefinitionType: 'bpmn:SignalEventDefinition',
        signalRef: { id: 'Signal_OrderCompleted', name: 'OrderCompleted' },
      })
    );
    s.broadcastThrowId = throwRes.elementId as string;

    // IntermediateCatchEvent (Receiver)
    const catchRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:IntermediateCatchEvent',
        name: 'Catch Completion Signal',
        eventDefinitionType: 'bpmn:SignalEventDefinition',
        signalRef: { id: 'Signal_OrderCompleted', name: 'OrderCompleted' },
      })
    );
    s.broadcastCatchId = catchRes.elementId as string;

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('OrderCompleted');
    expect(xml).toContain('Broadcast Completion');
    expect(xml).toContain('Catch Completion Signal');

    await assertStep(s.diagramId, 'S7-Step03', {
      containsElements: ['Broadcast Completion', 'Catch Completion Signal'],
      snapshotFile: 'story-07/step-03.bpmn',
    });
  });

  test('S7-Step04: Add escalation boundary event', async () => {
    // Task that may escalate
    const escalTaskRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Escalation Task',
      })
    );
    s.escalationTaskId = escalTaskRes.elementId as string;

    // Escalation boundary event
    const escalBoundaryRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: s.escalationTaskId,
        eventDefinitionType: 'bpmn:EscalationEventDefinition',
        escalationRef: {
          id: 'Escalation_ESC001',
          name: 'LevelOneEscalation',
          escalationCode: 'ESC_001',
        },
      })
    );
    s.escalationBoundaryId = escalBoundaryRes.elementId as string;

    // Handle Escalation task + EndEvent
    const handleEscRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Handle Escalation',
        afterElementId: s.escalationBoundaryId,
        autoConnect: false,
      })
    );
    s.handleEscalationId = handleEscRes.elementId as string;

    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.escalationBoundaryId,
      targetElementId: s.handleEscalationId,
    });

    await handleAddElement({
      diagramId: s.diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Escalated End',
      afterElementId: s.handleEscalationId,
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('escalationEventDefinition');
    expect(xml).toContain('ESC_001');

    await assertStep(s.diagramId, 'S7-Step04', {
      containsElements: ['Handle Escalation'],
      snapshotFile: 'story-07/step-04.bpmn',
    });
  });

  test('S7-Step05: Add link events (go-to pattern)', async () => {
    // Link throw event
    const linkThrowRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:IntermediateThrowEvent',
        name: 'Go to Review',
        eventDefinitionType: 'bpmn:LinkEventDefinition',
        eventDefinitionProperties: { name: 'ReviewLink' },
      })
    );
    s.linkThrowId = linkThrowRes.elementId as string;

    // Link catch event (matching name)
    const linkCatchRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:IntermediateCatchEvent',
        name: 'Resume at Review',
        eventDefinitionType: 'bpmn:LinkEventDefinition',
        eventDefinitionProperties: { name: 'ReviewLink' },
      })
    );
    s.linkCatchId = linkCatchRes.elementId as string;

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('linkEventDefinition');
    expect(xml).toContain('Go to Review');
    expect(xml).toContain('Resume at Review');

    await assertStep(s.diagramId, 'S7-Step05', {
      containsElements: ['Go to Review', 'Resume at Review'],
      snapshotFile: 'story-07/step-05.bpmn',
    });
  });

  test('S7-Step06: Add conditional boundary event', async () => {
    // Task with conditional boundary
    const conditTaskRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Monitor Stock',
      })
    );
    s.conditionalTaskId = conditTaskRes.elementId as string;

    // Non-interrupting conditional boundary
    const conditBoundaryRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: s.conditionalTaskId,
        eventDefinitionType: 'bpmn:ConditionalEventDefinition',
        eventDefinitionProperties: { condition: '${stockLevel < 10}' },
      })
    );
    s.conditionalBoundaryId = conditBoundaryRes.elementId as string;

    // Set non-interrupting
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.conditionalBoundaryId,
      properties: { cancelActivity: false },
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('conditionalEventDefinition');
    expect(xml).toContain('stockLevel');

    await assertStep(s.diagramId, 'S7-Step06', {
      snapshotFile: 'story-07/step-06.bpmn',
    });
  });

  test('S7-Step07: Layout and validate', async () => {
    await handleLayoutDiagram({ diagramId: s.diagramId });

    await assertStep(s.diagramId, 'S7-Step07', {
      // Many disconnected event elements by design (link throw/catch, signal broadcast,
      // conditional boundary, etc.); lint cleanliness is not the goal of this story
      snapshotFile: 'story-07/step-07.bpmn',
    });
  });
});
