/**
 * Story 4: Error Handling — Boundary Events, Subprocesses, Compensation
 *
 * Covers: add_bpmn_element (SubProcess, BoundaryEvent),
 * set_bpmn_event_definition (error, timer, signal, escalation,
 * terminate, compensate), set_bpmn_element_properties (triggeredByEvent),
 * set_bpmn_camunda_listeners, set_bpmn_loop_characteristics,
 * replace_bpmn_element, layout_bpmn_diagram
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElement,
  handleConnect,
  handleSetProperties,
  handleSetCamundaListeners,
  handleSetLoopCharacteristics,
  handleSetScript,
  handleLayoutDiagram,
  handleExportBpmn,
  handleImportXml,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { assertStep, parseResult } from './helpers';

describe('Story 4: Error Handling — Boundary Events, Subprocesses, Compensation', () => {
  const s = {
    diagramId: '',
    startId: '',
    subprocessId: '',
    endId: '',
    // Inside subprocess
    subStartId: '',
    chargeCardId: '',
    sendReceiptId: '',
    subEndId: '',
    // Error boundary
    errorBoundaryId: '',
    handleFailureId: '',
    paymentFailedEndId: '',
    // Timer boundary on Charge Card
    timerBoundaryId: '',
    logTimeoutId: '',
    // Event subprocess
    eventSubprocessId: '',
    eventSubStartId: '',
    processCancellationId: '',
    eventSubEndId: '',
    // Compensation
    compensateBoundaryId: '',
    refundPaymentId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  test('S4-Step01: Create base process with subprocess', async () => {
    const createRes = parseResult(await handleCreateDiagram({ name: 'Payment Processing' }));
    s.diagramId = createRes.diagramId as string;

    s.startId = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start',
      })
    ).elementId as string;

    const subRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:SubProcess',
        name: 'Process Payment',
        isExpanded: true,
        afterElementId: s.startId,
      })
    );
    s.subprocessId = subRes.elementId as string;

    const endRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Payment Done',
        afterElementId: s.subprocessId,
      })
    );
    s.endId = endRes.elementId as string;

    // Add elements INSIDE the subprocess
    const subStartRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Sub Start',
        parentId: s.subprocessId,
      })
    );
    s.subStartId = subStartRes.elementId as string;

    const chargeRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Charge Card',
        parentId: s.subprocessId,
        afterElementId: s.subStartId,
      })
    );
    s.chargeCardId = chargeRes.elementId as string;

    const receiptRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Send Receipt',
        parentId: s.subprocessId,
        afterElementId: s.chargeCardId,
      })
    );
    s.sendReceiptId = receiptRes.elementId as string;

    const subEndRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Sub End',
        parentId: s.subprocessId,
        afterElementId: s.sendReceiptId,
      })
    );
    s.subEndId = subEndRes.elementId as string;

    await assertStep(s.diagramId, 'S4-Step01', {
      containsElements: ['Process Payment', 'Charge Card', 'Send Receipt'],
      snapshotFile: 'story-04/step-01.bpmn',
    });
  });

  test('S4-Step02: Add error boundary event on subprocess', async () => {
    // Error boundary on the subprocess
    const errorBoundaryRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: s.subprocessId,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        errorRef: { id: 'Error_PaymentFailed', name: 'PaymentFailed', errorCode: 'PAY_ERR' },
      })
    );
    s.errorBoundaryId = errorBoundaryRes.elementId as string;

    // Handle Payment Failure task
    const handleFailRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Handle Payment Failure',
        afterElementId: s.errorBoundaryId,
        autoConnect: false,
      })
    );
    s.handleFailureId = handleFailRes.elementId as string;

    // Terminate end event
    const paymentFailedEndRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Payment Failed',
        afterElementId: s.handleFailureId,
        autoConnect: false,
        eventDefinitionType: 'bpmn:TerminateEventDefinition',
      })
    );
    s.paymentFailedEndId = paymentFailedEndRes.elementId as string;

    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.errorBoundaryId,
      targetElementId: s.handleFailureId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.handleFailureId,
      targetElementId: s.paymentFailedEndId,
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('errorEventDefinition');
    expect(xml).toContain('PAY_ERR');
    expect(xml).toContain('terminateEventDefinition');

    await assertStep(s.diagramId, 'S4-Step02', {
      containsElements: ['Handle Payment Failure', 'Payment Failed'],
      snapshotFile: 'story-04/step-02.bpmn',
    });
  });

  test('S4-Step03: Add timer boundary on Charge Card (inside subprocess)', async () => {
    // Non-interrupting timer boundary on Charge Card
    const timerBoundaryRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: s.chargeCardId,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT30S' },
      })
    );
    s.timerBoundaryId = timerBoundaryRes.elementId as string;

    // Set non-interrupting
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.timerBoundaryId,
      properties: { cancelActivity: false },
    });

    // Script task after timer boundary
    const logRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ScriptTask',
        name: 'Log Timeout Warning',
        afterElementId: s.timerBoundaryId,
        autoConnect: false,
      })
    );
    s.logTimeoutId = logRes.elementId as string;

    await handleSetScript({
      diagramId: s.diagramId,
      elementId: s.logTimeoutId,
      scriptFormat: 'groovy',
      script: 'println "Charge taking long"',
      resultVariable: 'logResult',
    });

    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.timerBoundaryId,
      targetElementId: s.logTimeoutId,
    });

    // Terminate the timer boundary path to avoid implicit-end lint errors
    await handleAddElement({
      diagramId: s.diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Timeout Logged',
      afterElementId: s.logTimeoutId,
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('timerEventDefinition');
    expect(xml).toContain('PT30S');
    expect(xml).toContain('Log Timeout Warning');

    await assertStep(s.diagramId, 'S4-Step03', {
      snapshotFile: 'story-04/step-03.bpmn',
    });
  });

  test('S4-Step04: Add event subprocess for cancellation', async () => {
    // Add event subprocess (triggered by event)
    const eventSubRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:SubProcess',
        name: 'Cancellation Handler',
        isExpanded: true,
      })
    );
    s.eventSubprocessId = eventSubRes.elementId as string;

    // Mark as event subprocess
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.eventSubprocessId,
      properties: { triggeredByEvent: true },
    });

    // Add start event (non-interrupting message) inside event subprocess
    const evSubStartRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Cancellation Requested',
        parentId: s.eventSubprocessId,
        eventDefinitionType: 'bpmn:MessageEventDefinition',
        messageRef: { id: 'Msg_CancellationRequest', name: 'CancellationRequest' },
      })
    );
    s.eventSubStartId = evSubStartRes.elementId as string;

    // Set non-interrupting on the start event
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.eventSubStartId,
      properties: { isInterrupting: false },
    });

    const processCancRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Process Cancellation',
        parentId: s.eventSubprocessId,
        afterElementId: s.eventSubStartId,
      })
    );
    s.processCancellationId = processCancRes.elementId as string;

    const evSubEndRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Cancelled',
        parentId: s.eventSubprocessId,
        afterElementId: s.processCancellationId,
      })
    );
    s.eventSubEndId = evSubEndRes.elementId as string;

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('triggeredByEvent="true"');
    expect(xml).toContain('Cancellation Handler');

    await assertStep(s.diagramId, 'S4-Step04', {
      containsElements: ['Cancellation Handler', 'Process Cancellation'],
      snapshotFile: 'story-04/step-04.bpmn',
    });
  });

  test('S4-Step05: Add compensation boundary + handler', async () => {
    // Add compensate boundary on Charge Card
    const compensateRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: s.chargeCardId,
        eventDefinitionType: 'bpmn:CompensateEventDefinition',
      })
    );
    s.compensateBoundaryId = compensateRes.elementId as string;

    // Add compensation handler ServiceTask
    const refundRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Refund Payment',
        afterElementId: s.compensateBoundaryId,
        autoConnect: false,
      })
    );
    s.refundPaymentId = refundRes.elementId as string;

    // Mark compensation handler and connect via Association (required by BPMN spec)
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.refundPaymentId,
      properties: { isForCompensation: true },
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.compensateBoundaryId,
      targetElementId: s.refundPaymentId,
      connectionType: 'bpmn:Association',
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('compensateEventDefinition');
    expect(xml).toContain('Refund Payment');

    await assertStep(s.diagramId, 'S4-Step05', {
      snapshotFile: 'story-04/step-05.bpmn',
    });
  });

  test('S4-Step06: Add multi-instance on Send Receipt', async () => {
    await handleSetLoopCharacteristics({
      diagramId: s.diagramId,
      elementId: s.sendReceiptId,
      loopType: 'parallel',
      collection: '${recipients}',
      elementVariable: 'recipient',
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('multiInstanceLoopCharacteristics');
    expect(xml).toContain('recipients');

    await assertStep(s.diagramId, 'S4-Step06', {
      snapshotFile: 'story-04/step-06.bpmn',
    });
  });

  test('S4-Step07: Add execution listener on Charge Card', async () => {
    await handleSetCamundaListeners({
      diagramId: s.diagramId,
      elementId: s.chargeCardId,
      executionListeners: [{ event: 'end', class: 'com.example.PaymentAuditListener' }],
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('executionListener');
    expect(xml).toContain('com.example.PaymentAuditListener');

    await assertStep(s.diagramId, 'S4-Step07', {
      snapshotFile: 'story-04/step-07.bpmn',
    });
  });

  test('S4-Step08: Layout and validate', async () => {
    await handleLayoutDiagram({ diagramId: s.diagramId });

    await assertStep(s.diagramId, 'S4-Step08', {
      snapshotFile: 'story-04/step-08.bpmn',
    });
  });

  test('S4-Step09: Re-import and verify', async () => {
    const exportRes = await handleExportBpmn({
      format: 'xml',
      diagramId: s.diagramId,
      skipLint: true,
    });
    const xml = exportRes.content[0].text;

    const importRes = parseResult(await handleImportXml({ xml }));
    expect(importRes.success).toBe(true);

    await assertStep(importRes.diagramId as string, 'S4-Step09', {
      containsElements: [
        'Process Payment',
        'Charge Card',
        'Send Receipt',
        'Handle Payment Failure',
        'Cancellation Handler',
        'Refund Payment',
      ],
    });
  });
});
