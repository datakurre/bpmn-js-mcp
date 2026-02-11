import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleSetProperties,
  handleSetInputOutput,
  handleSetEventDefinition,
  handleExportBpmn,
} from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../helpers';

describe('Camunda 7 External Task workflow', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates a full external task with topic, I/O mapping, and boundary error', async () => {
    const diagramId = await createDiagram('External Task Process');

    // 1. Create service task with external task type
    const serviceTaskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Order',
      x: 300,
      y: 200,
    });
    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'camunda:type': 'external',
        'camunda:topic': 'order-processing',
      },
    });

    // 2. Set input/output mappings
    await handleSetInputOutput({
      diagramId,
      elementId: serviceTaskId,
      inputParameters: [{ name: 'orderId', value: "${execution.getVariable('orderId')}" }],
      outputParameters: [{ name: 'result', value: '${orderResult}' }],
    });

    // 3. Attach boundary error event
    const boundaryId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      hostElementId: serviceTaskId,
      x: 320,
      y: 260,
    });
    await handleSetEventDefinition({
      diagramId,
      elementId: boundaryId,
      eventDefinitionType: 'bpmn:ErrorEventDefinition',
      errorRef: {
        id: 'Error_OrderFailed',
        name: 'Order Failed',
        errorCode: 'ORDER_ERR',
      },
    });

    // Verify the full XML
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:type="external"');
    expect(xml).toContain('camunda:topic="order-processing"');
    expect(xml).toContain('camunda:inputOutput');
    expect(xml).toContain('orderId');
    expect(xml).toContain('errorEventDefinition');
  });

  test('auto-sets camunda:type=external when only camunda:topic is provided', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Auto External',
    });

    // Only set topic — type should be auto-set to "external"
    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        'camunda:topic': 'my-topic',
      },
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:type="external"');
    expect(xml).toContain('camunda:topic="my-topic"');
  });
});
