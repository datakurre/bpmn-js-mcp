/**
 * Story 1: Order Processing — From Empty to Executable
 *
 * Covers: create_bpmn_diagram, add_bpmn_element, add_bpmn_element_chain,
 * connect_bpmn_elements, set_bpmn_element_properties, set_bpmn_form_data,
 * set_bpmn_input_output_mapping, set_bpmn_event_definition,
 * layout_bpmn_diagram, validate_bpmn_diagram, export_bpmn
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElementChain,
  handleAddElement,
  handleConnect,
  handleListElements,
  handleSetProperties,
  handleSetFormData,
  handleSetInputOutput,
  handleLayoutDiagram,
  handleExportBpmn,
  handleImportXml,
  handleGetProperties,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { assertStep, findFlowBetween, parseResult } from './helpers';

describe('Story 1: Order Processing — From Empty to Executable', () => {
  // Shared state across sequential steps
  const s = {
    diagramId: '',
    processId: '',
    startId: '',
    reviewOrderId: '',
    checkInventoryId: '',
    confirmOrderId: '',
    completedId: '',
    reviewOrderToCheckInventoryFlowId: '',
    gatewayId: '',
    checkInventoryFlowId: '',
    noFlowId: '',
    handleRejectionId: '',
    orderRejectedId: '',
    boundaryId: '',
    sendReminderId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  test('S1-Step01: Create empty diagram', async () => {
    const res = parseResult(await handleCreateDiagram({ name: 'Order Processing' }));
    expect(res.success).toBe(true);
    s.diagramId = res.diagramId;

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('isExecutable="true"');
    expect(xml).toContain('Order Processing');

    // Capture process element ID from the element list
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    // Process element is in the registry; find it
    const processEl = listRes.elements.find((e: any) => e.type === 'bpmn:Process');
    if (processEl) s.processId = processEl.id;

    await assertStep(s.diagramId, 'S1-Step01', {
      snapshotFile: 'story-01/step-01.bpmn',
    });
  });

  test('S1-Step02: Build happy path as a chain', async () => {
    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId: s.diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Order Received' },
          { elementType: 'bpmn:UserTask', name: 'Review Order' },
          { elementType: 'bpmn:ServiceTask', name: 'Check Inventory' },
          { elementType: 'bpmn:UserTask', name: 'Confirm Order' },
          { elementType: 'bpmn:EndEvent', name: 'Order Completed' },
        ],
      })
    );
    expect(chainRes.success).toBe(true);
    expect(chainRes.elementCount).toBe(5);
    expect(chainRes.elementIds).toHaveLength(5);

    [s.startId, s.reviewOrderId, s.checkInventoryId, s.confirmOrderId, s.completedId] =
      chainRes.elementIds as string[];

    // Validate chain connections
    expect(chainRes.elements[0].connectionId).toBeUndefined();
    expect(chainRes.elements[1].connectionId).toBeDefined();
    expect(chainRes.elements[2].connectionId).toBeDefined();
    expect(chainRes.elements[3].connectionId).toBeDefined();
    expect(chainRes.elements[4].connectionId).toBeDefined();

    // The flow from Review Order → Check Inventory is elements[2].connectionId
    s.reviewOrderToCheckInventoryFlowId = chainRes.elements[2].connectionId as string;

    await assertStep(s.diagramId, 'S1-Step02', {
      containsElements: [
        'Order Received',
        'Review Order',
        'Check Inventory',
        'Confirm Order',
        'Order Completed',
      ],
      snapshotFile: 'story-01/step-02.bpmn',
    });
  });

  test('S1-Step03: Add exclusive gateway for approval', async () => {
    // Insert gateway into the ReviewOrder → CheckInventory flow
    const gwRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Order Valid?',
        flowId: s.reviewOrderToCheckInventoryFlowId,
      })
    );
    expect(gwRes.success).toBe(true);
    s.gatewayId = gwRes.elementId as string;

    // Find the new gateway → CheckInventory flow
    const yesFlow = await findFlowBetween(s.diagramId, s.gatewayId, s.checkInventoryId);
    expect(yesFlow).toBeDefined();
    s.checkInventoryFlowId = yesFlow!.id as string;

    // Add rejection branch
    const handleRejRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Handle Rejection',
        afterElementId: s.gatewayId,
        autoConnect: false,
      })
    );
    s.handleRejectionId = handleRejRes.elementId as string;

    const orderRejRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Order Rejected',
        afterElementId: s.handleRejectionId,
        autoConnect: false,
      })
    );
    s.orderRejectedId = orderRejRes.elementId as string;

    // Connect rejection path
    const noFlowRes = parseResult(
      await handleConnect({
        diagramId: s.diagramId,
        sourceElementId: s.gatewayId,
        targetElementId: s.handleRejectionId,
        label: 'No',
      })
    );
    s.noFlowId = noFlowRes.connectionId as string;

    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.handleRejectionId,
      targetElementId: s.orderRejectedId,
    });

    // Set conditions and labels on flows
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.checkInventoryFlowId,
      properties: { name: 'Yes', conditionExpression: '${orderValid == true}' },
    });

    // Set No flow as gateway default (unconditional fallback; default must NOT have a condition)
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.gatewayId,
      properties: { default: s.noFlowId },
    });

    await assertStep(s.diagramId, 'S1-Step03', {
      containsElements: ['Order Valid?', 'Handle Rejection', 'Order Rejected'],
      snapshotFile: 'story-01/step-03.bpmn',
    });
  });

  test('S1-Step04: Set Camunda properties', async () => {
    // Process: historyTimeToLive (already set to P180D by default, set explicitly)
    if (s.processId) {
      await handleSetProperties({
        diagramId: s.diagramId,
        elementId: s.processId,
        properties: { 'camunda:historyTimeToLive': 'P180D' },
      });
    }

    // Review Order: assignee + formKey
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.reviewOrderId,
      properties: {
        'camunda:assignee': 'reviewer',
        'camunda:formKey': 'embedded:app:forms/review.html',
      },
    });

    // Check Inventory: implementation class
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.checkInventoryId,
      properties: { 'camunda:class': 'com.example.CheckInventory' },
    });

    // Confirm Order: candidate groups
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.confirmOrderId,
      properties: { 'camunda:candidateGroups': 'managers' },
    });

    // Verify Review Order properties
    const reviewProps = parseResult(
      await handleGetProperties({ diagramId: s.diagramId, elementId: s.reviewOrderId })
    );
    expect(reviewProps.camundaProperties?.['camunda:assignee']).toBe('reviewer');
    expect(reviewProps.camundaProperties?.['camunda:formKey']).toBe('embedded:app:forms/review.html');

    // Verify Check Inventory properties
    const checkProps = parseResult(
      await handleGetProperties({ diagramId: s.diagramId, elementId: s.checkInventoryId })
    );
    expect(checkProps.camundaProperties?.['camunda:class']).toBe('com.example.CheckInventory');

    await assertStep(s.diagramId, 'S1-Step04', {
      snapshotFile: 'story-01/step-04.bpmn',
    });
  });

  test('S1-Step05: Add form fields to start event', async () => {
    const formRes = parseResult(
      await handleSetFormData({
        diagramId: s.diagramId,
        elementId: s.startId,
        fields: [
          { id: 'orderId', label: 'Order ID', type: 'string', validation: [{ name: 'required' }] },
          {
            id: 'quantity',
            label: 'Quantity',
            type: 'long',
            validation: [{ name: 'min', config: '1' }],
          },
          {
            id: 'priority',
            label: 'Priority',
            type: 'enum',
            defaultValue: 'medium',
            values: [
              { id: 'low', name: 'Low' },
              { id: 'medium', name: 'Medium' },
              { id: 'high', name: 'High' },
            ],
          },
        ],
      })
    );
    expect(formRes.success).toBe(true);
    expect(formRes.fieldCount).toBe(3);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('camunda:formData');
    expect(xml).toContain('orderId');
    expect(xml).toContain('quantity');
    expect(xml).toContain('priority');

    await assertStep(s.diagramId, 'S1-Step05', {
      snapshotFile: 'story-01/step-05.bpmn',
    });
  });

  test('S1-Step06: Add I/O mappings to Check Inventory', async () => {
    const ioRes = parseResult(
      await handleSetInputOutput({
        diagramId: s.diagramId,
        elementId: s.checkInventoryId,
        inputParameters: [
          { name: 'orderId', value: '${orderId}' },
          { name: 'qty', value: '${quantity}' },
        ],
        outputParameters: [{ name: 'inventoryOk', value: '${available}' }],
      })
    );
    expect(ioRes.success).toBe(true);
    expect(ioRes.inputParameterCount).toBe(2);
    expect(ioRes.outputParameterCount).toBe(1);

    await assertStep(s.diagramId, 'S1-Step06', {
      snapshotFile: 'story-01/step-06.bpmn',
    });
  });

  test('S1-Step07: Add timer boundary event (non-interrupting)', async () => {
    // Add boundary event on Review Order
    const boundaryRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: s.reviewOrderId,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT24H' },
      })
    );
    expect(boundaryRes.success).toBe(true);
    s.boundaryId = boundaryRes.elementId as string;

    // Make it non-interrupting
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.boundaryId,
      properties: { cancelActivity: false },
    });

    // Add SendTask after boundary
    const sendReminderRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:SendTask',
        name: 'Send Reminder',
        afterElementId: s.boundaryId,
        autoConnect: false,
      })
    );
    s.sendReminderId = sendReminderRes.elementId as string;

    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.boundaryId,
      targetElementId: s.sendReminderId,
    });

    // Terminate the boundary path so the diagram is lint-clean
    await handleAddElement({
      diagramId: s.diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Reminder Sent',
      afterElementId: s.sendReminderId,
    });

    // Verify boundary event is configured
    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('timerEventDefinition');
    expect(xml).toContain('PT24H');
    expect(xml).toContain('cancelActivity="false"');

    await assertStep(s.diagramId, 'S1-Step07', {
      containsElements: ['Send Reminder'],
      snapshotFile: 'story-01/step-07.bpmn',
    });
  });

  test('S1-Step08: Layout and validate', async () => {
    // Layout the diagram
    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId: s.diagramId }));
    expect(layoutRes.success).toBe(true);

    // Validate: expect 0 lint errors
    await assertStep(s.diagramId, 'S1-Step08', {
      lintErrorCount: 0,
      snapshotFile: 'story-01/step-08.bpmn',
    });
  });

  test('S1-Step09: Re-import and verify round-trip', async () => {
    // Export current XML
    const exportRes = await handleExportBpmn({
      format: 'xml',
      diagramId: s.diagramId,
      skipLint: true,
    });
    const xml = exportRes.content[0].text;

    // Re-import
    const importRes = parseResult(await handleImportXml({ xml }));
    expect(importRes.success).toBe(true);
    const reimportedId = importRes.diagramId as string;

    // Validate reimported diagram
    await assertStep(reimportedId, 'S1-Step09', {
      containsElements: [
        'Order Received',
        'Review Order',
        'Check Inventory',
        'Confirm Order',
        'Order Completed',
        'Order Valid?',
        'Handle Rejection',
        'Order Rejected',
        'Send Reminder',
        'Reminder Sent',
      ],
      lintErrorCount: 0,
    });
  });
});
