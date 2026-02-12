import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleListProcessVariables,
  handleSetInputOutput,
  handleSetFormData,
  handleSetLoopCharacteristics,
  handleSetScript,
} from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../helpers';

describe('list_bpmn_process_variables', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('returns empty variables for an empty diagram', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(await handleListProcessVariables({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.variableCount).toBe(0);
    expect(res.variables).toEqual([]);
  });

  test('extracts form field variables from user tasks', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });

    await handleSetFormData({
      diagramId,
      elementId: taskId,
      fields: [
        { id: 'firstName', label: 'First Name', type: 'string' },
        { id: 'lastName', label: 'Last Name', type: 'string' },
      ],
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    expect(res.variableCount).toBe(2);
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('firstName');
    expect(names).toContain('lastName');

    const firstNameVar = res.variables.find((v: any) => v.name === 'firstName');
    expect(firstNameVar.writtenBy.length).toBeGreaterThan(0);
    expect(firstNameVar.writtenBy[0].source).toBe('formField');
  });

  test('extracts input/output parameter variables', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API' });

    await handleSetInputOutput({
      diagramId,
      elementId: taskId,
      inputParameters: [{ name: 'apiUrl', value: '${baseUrl}/endpoint' }],
      outputParameters: [{ name: 'result', value: '${response}' }],
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('apiUrl');
    expect(names).toContain('result');
    expect(names).toContain('baseUrl');
    expect(names).toContain('response');
  });

  test('extracts variables from condition expressions', async () => {
    const diagramId = await createDiagram();
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check?' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Yes path' });

    await connect(diagramId, gw, taskA, { conditionExpression: '${approved == true}' });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('approved');

    const approvedVar = res.variables.find((v: any) => v.name === 'approved');
    expect(approvedVar.readBy.length).toBeGreaterThan(0);
    expect(approvedVar.readBy[0].source).toBe('conditionExpression');
  });

  test('extracts loop collection and element variables', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Item' });

    await handleSetLoopCharacteristics({
      diagramId,
      elementId: taskId,
      loopType: 'parallel',
      collection: 'orderItems',
      elementVariable: 'currentItem',
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('orderItems');
    expect(names).toContain('currentItem');

    const orderItemsVar = res.variables.find((v: any) => v.name === 'orderItems');
    expect(orderItemsVar.readBy[0].source).toBe('loop.collection');

    const currentItemVar = res.variables.find((v: any) => v.name === 'currentItem');
    expect(currentItemVar.writtenBy[0].source).toBe('loop.elementVariable');
  });

  test('extracts script result variable', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ScriptTask', { name: 'Calculate' });

    await handleSetScript({
      diagramId,
      elementId: taskId,
      scriptFormat: 'groovy',
      script: 'return 42',
      resultVariable: 'calculatedValue',
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('calculatedValue');

    const calcVar = res.variables.find((v: any) => v.name === 'calculatedValue');
    expect(calcVar.writtenBy[0].source).toBe('scriptTask.resultVariable');
  });

  test('returns variables sorted alphabetically', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });

    await handleSetFormData({
      diagramId,
      elementId: taskId,
      fields: [
        { id: 'zebra', label: 'Zebra', type: 'string' },
        { id: 'apple', label: 'Apple', type: 'string' },
        { id: 'mango', label: 'Mango', type: 'string' },
      ],
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toEqual(['apple', 'mango', 'zebra']);
  });
});
