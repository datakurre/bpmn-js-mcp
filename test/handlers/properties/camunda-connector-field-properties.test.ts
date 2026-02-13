/**
 * Tests for camunda:Connector, camunda:Field, and camunda:Properties
 * support in set_bpmn_element_properties.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';
import { handleSetProperties } from '../../../src/handlers/properties/set-properties';
import { handleGetProperties } from '../../../src/handlers/elements/get-properties';

afterEach(() => clearDiagrams());

describe('camunda:Connector', () => {
  test('sets a connector with connectorId and nested inputOutput', async () => {
    const diagramId = await createDiagram();
    const serviceTaskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API' });

    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'camunda:connector': {
          connectorId: 'http-connector',
          inputOutput: {
            inputParameters: [
              { name: 'url', value: 'https://api.example.com' },
              { name: 'method', value: 'GET' },
            ],
            outputParameters: [{ name: 'response', value: '${S(response)}' }],
          },
        },
      },
    });

    const propsResult = parseResult(
      await handleGetProperties({ diagramId, elementId: serviceTaskId })
    );

    // Verify connector was created in extension elements
    const extensions = propsResult.extensionElements;
    expect(extensions).toBeDefined();
    const connector = extensions.find((e: any) => e.type === 'camunda:Connector');
    expect(connector).toBeDefined();
    expect(connector.connectorId).toBe('http-connector');
  });

  test('removes connector when set to null', async () => {
    const diagramId = await createDiagram();
    const serviceTaskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API' });

    // Set connector
    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'camunda:connector': { connectorId: 'http-connector' },
      },
    });

    // Remove connector
    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'camunda:connector': null,
      },
    });

    const propsResult = parseResult(
      await handleGetProperties({ diagramId, elementId: serviceTaskId })
    );
    const extensions = propsResult.extensionElements || [];
    const connector = extensions.find((e: any) => e.type === 'camunda:Connector');
    expect(connector).toBeUndefined();
  });
});

describe('camunda:Field', () => {
  test('sets field injection on a service task', async () => {
    const diagramId = await createDiagram();
    const serviceTaskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Send Mail' });

    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'camunda:class': 'com.example.MailService',
        'camunda:field': [
          { name: 'to', stringValue: 'admin@example.com' },
          { name: 'subject', expression: '${order.summary}' },
        ],
      },
    });

    const propsResult = parseResult(
      await handleGetProperties({ diagramId, elementId: serviceTaskId })
    );

    const extensions = propsResult.extensionElements || [];
    const fields = extensions.filter((e: any) => e.type === 'camunda:Field');
    expect(fields.length).toBe(2);
  });

  test('removes fields when set to empty array', async () => {
    const diagramId = await createDiagram();
    const serviceTaskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Send Mail' });

    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'camunda:field': [{ name: 'to', stringValue: 'admin@example.com' }],
      },
    });

    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'camunda:field': [],
      },
    });

    const propsResult = parseResult(
      await handleGetProperties({ diagramId, elementId: serviceTaskId })
    );
    const extensions = propsResult.extensionElements || [];
    const fields = extensions.filter((e: any) => e.type === 'camunda:Field');
    expect(fields.length).toBe(0);
  });
});

describe('camunda:Properties', () => {
  test('sets generic key-value properties on an element', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        'camunda:properties': {
          category: 'approval',
          priority: 'high',
        },
      },
    });

    const propsResult = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));

    const extensions = propsResult.extensionElements || [];
    const props = extensions.find((e: any) => e.type === 'camunda:Properties');
    expect(props).toBeDefined();
  });

  test('removes properties when set to empty object', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        'camunda:properties': { key: 'value' },
      },
    });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        'camunda:properties': {},
      },
    });

    const propsResult = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const extensions = propsResult.extensionElements || [];
    const props = extensions.find((e: any) => e.type === 'camunda:Properties');
    expect(props).toBeUndefined();
  });
});
