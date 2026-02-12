/**
 * Tests for P0 camunda-bpmn-moddle gap coverage improvements:
 * - Listener serialization in get_bpmn_element_properties
 * - camunda:In/Out serialization in get_bpmn_element_properties
 * - camunda:FailedJobRetryTimeCycle support
 * - ConditionalEventDefinition camunda variables
 * - camunda:errorMessage on bpmn:Error
 * - ErrorCodeVariable/ErrorMessageVariable on ErrorEventDefinition
 * - Tool-discovery hints after add/replace
 * - Fix suggestions in appendLintFeedback
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleGetProperties,
  handleSetProperties,
  handleSetCamundaListeners,
  handleSetCallActivityVariables,
  handleSetEventDefinition,
  handleAddElement,
  handleReplaceElement,
  handleExportBpmn,
} from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('get_bpmn_element_properties — listener serialization', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('serializes execution listener details', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'My Task',
      x: 200,
      y: 100,
    });
    await handleSetCamundaListeners({
      diagramId,
      elementId: taskId,
      executionListeners: [
        { event: 'start', class: 'com.example.StartListener' },
        { event: 'end', delegateExpression: '${endHandler}' },
      ],
    });

    const res = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const listeners = res.extensionElements.filter(
      (e: any) => e.type === 'camunda:ExecutionListener'
    );
    expect(listeners).toHaveLength(2);
    expect(listeners[0].event).toBe('start');
    expect(listeners[0].class).toBe('com.example.StartListener');
    expect(listeners[1].event).toBe('end');
    expect(listeners[1].delegateExpression).toBe('${endHandler}');
  });

  test('serializes task listener details', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
      x: 200,
      y: 100,
    });
    await handleSetCamundaListeners({
      diagramId,
      elementId: taskId,
      taskListeners: [{ event: 'create', expression: '${assignTask}' }],
    });

    const res = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const listeners = res.extensionElements.filter((e: any) => e.type === 'camunda:TaskListener');
    expect(listeners).toHaveLength(1);
    expect(listeners[0].event).toBe('create');
    expect(listeners[0].expression).toBe('${assignTask}');
  });

  test('serializes listener with inline script', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Scripted',
      x: 200,
      y: 100,
    });
    await handleSetCamundaListeners({
      diagramId,
      elementId: taskId,
      executionListeners: [
        {
          event: 'start',
          script: { scriptFormat: 'groovy', value: 'println "hello"' },
        },
      ],
    });

    const res = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const listener = res.extensionElements.find((e: any) => e.type === 'camunda:ExecutionListener');
    expect(listener.script).toBeDefined();
    expect(listener.script.scriptFormat).toBe('groovy');
    expect(listener.script.value).toBe('println "hello"');
  });
});

describe('get_bpmn_element_properties — camunda:In/Out serialization', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('serializes call activity variable mappings', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', {
      name: 'Call Sub',
      x: 200,
      y: 100,
    });
    await handleSetCallActivityVariables({
      diagramId,
      elementId: callId,
      inMappings: [{ source: 'orderId', target: 'id' }],
      outMappings: [{ source: 'result', target: 'subResult' }],
    });

    const res = parseResult(await handleGetProperties({ diagramId, elementId: callId }));
    const inExt = res.extensionElements.find((e: any) => e.type === 'camunda:In');
    const outExt = res.extensionElements.find((e: any) => e.type === 'camunda:Out');
    expect(inExt).toBeDefined();
    expect(inExt.source).toBe('orderId');
    expect(inExt.target).toBe('id');
    expect(outExt).toBeDefined();
    expect(outExt.source).toBe('result');
    expect(outExt.target).toBe('subResult');
  });
});

describe('camunda:FailedJobRetryTimeCycle support', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets retry time cycle on a service task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Retry Task',
      x: 200,
      y: 100,
    });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        'camunda:retryTimeCycle': 'R3/PT10M',
      },
    });

    // Verify via XML export
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:failedJobRetryTimeCycle');
    expect(xml).toContain('R3/PT10M');

    // Verify via get_properties
    const res = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const retryExt = res.extensionElements?.find(
      (e: any) => e.type === 'camunda:FailedJobRetryTimeCycle'
    );
    expect(retryExt).toBeDefined();
    expect(retryExt.body).toBe('R3/PT10M');
  });

  test('clears retry time cycle when set to empty', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Retry Task',
      x: 200,
      y: 100,
    });

    // Set then clear
    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { 'camunda:retryTimeCycle': 'R3/PT10M' },
    });
    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { 'camunda:retryTimeCycle': '' },
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).not.toContain('failedJobRetryTimeCycle');
  });
});

describe('ConditionalEventDefinition camunda variables', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets variableName and variableEvents on conditional event', async () => {
    const diagramId = await createDiagram();
    const catchId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', {
      x: 200,
      y: 200,
    });

    await handleSetEventDefinition({
      diagramId,
      elementId: catchId,
      eventDefinitionType: 'bpmn:ConditionalEventDefinition',
      properties: {
        condition: '${status == "active"}',
        variableName: 'status',
        variableEvents: 'create, update',
      },
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('conditionalEventDefinition');
    expect(xml).toContain('camunda:variableName="status"');
    expect(xml).toContain('camunda:variableEvents="create, update"');

    // Also verify via get_properties
    const res = parseResult(await handleGetProperties({ diagramId, elementId: catchId }));
    const eventDef = res.eventDefinitions?.[0];
    expect(eventDef['camunda:variableName']).toBe('status');
    expect(eventDef['camunda:variableEvents']).toBe('create, update');
  });
});

describe('ErrorEventDefinition camunda variables', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets errorCodeVariable and errorMessageVariable', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'API Call',
      x: 200,
      y: 200,
    });
    const boundaryId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      hostElementId: taskId,
    });

    await handleSetEventDefinition({
      diagramId,
      elementId: boundaryId,
      eventDefinitionType: 'bpmn:ErrorEventDefinition',
      errorRef: { id: 'Error_1', name: 'ApiError', errorCode: 'ERR_API' },
      properties: {
        errorCodeVariable: 'errCode',
        errorMessageVariable: 'errMsg',
      },
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:errorCodeVariable="errCode"');
    expect(xml).toContain('camunda:errorMessageVariable="errMsg"');

    // Verify via get_properties
    const res = parseResult(await handleGetProperties({ diagramId, elementId: boundaryId }));
    const eventDef = res.eventDefinitions?.[0];
    expect(eventDef['camunda:errorCodeVariable']).toBe('errCode');
    expect(eventDef['camunda:errorMessageVariable']).toBe('errMsg');
  });
});

describe('camunda:errorMessage on bpmn:Error', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('passes errorMessage through to bpmn:Error root element', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Task',
      x: 200,
      y: 200,
    });
    const boundaryId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      hostElementId: taskId,
    });

    await handleSetEventDefinition({
      diagramId,
      elementId: boundaryId,
      eventDefinitionType: 'bpmn:ErrorEventDefinition',
      errorRef: {
        id: 'Error_2',
        name: 'DetailedError',
        errorCode: 'ERR_002',
        errorMessage: 'Something went wrong',
      },
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:errorMessage="Something went wrong"');
  });
});

describe('tool-discovery hints', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('add_bpmn_element returns nextSteps for UserTask', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review',
      })
    );
    expect(res.nextSteps).toBeDefined();
    expect(res.nextSteps.length).toBeGreaterThan(0);
    expect(res.nextSteps.some((h: any) => h.tool === 'set_bpmn_form_data')).toBe(true);
  });

  test('add_bpmn_element returns nextSteps for ServiceTask', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Call API',
      })
    );
    expect(res.nextSteps).toBeDefined();
    expect(res.nextSteps.some((h: any) => h.tool === 'set_bpmn_element_properties')).toBe(true);
  });

  test('add_bpmn_element returns nextSteps for ScriptTask', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ScriptTask',
        name: 'Run Script',
      })
    );
    expect(res.nextSteps).toBeDefined();
    expect(res.nextSteps.some((h: any) => h.tool === 'set_bpmn_script')).toBe(true);
  });

  test('add_bpmn_element returns nextSteps for CallActivity', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:CallActivity',
        name: 'Call Sub',
      })
    );
    expect(res.nextSteps).toBeDefined();
    expect(res.nextSteps.some((h: any) => h.tool === 'set_bpmn_call_activity_variables')).toBe(
      true
    );
  });

  test('replace_bpmn_element returns nextSteps for new type', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Generic' });

    const res = parseResult(
      await handleReplaceElement({
        diagramId,
        elementId: taskId,
        newType: 'bpmn:UserTask',
      })
    );
    expect(res.nextSteps).toBeDefined();
    expect(res.nextSteps.some((h: any) => h.tool === 'set_bpmn_form_data')).toBe(true);
  });

  test('add_bpmn_element returns no nextSteps for StartEvent', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
      })
    );
    expect(res.nextSteps).toBeUndefined();
  });
});
