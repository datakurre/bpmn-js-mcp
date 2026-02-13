/**
 * Tests for list_bpmn_process_variables — extended coverage.
 *
 * Covers: camunda expression properties (assignee etc), call activity
 * variable mappings, form field default value expressions, and
 * deduplication of variable references.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleListProcessVariables,
  handleSetProperties,
  handleSetCallActivityVariables,
  handleSetFormData,
  handleSetLoopCharacteristics,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('list_bpmn_process_variables — extended', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('extracts variables from camunda:assignee expression', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { 'camunda:assignee': '${initiator}' },
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('initiator');

    const initVar = res.variables.find((v: any) => v.name === 'initiator');
    expect(initVar.readBy[0].source).toBe('assignee');
  });

  test('extracts variables from camunda:candidateGroups expression', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { 'camunda:candidateGroups': '${department}' },
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('department');
  });

  test('extracts variables from call activity in/out mappings', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Sub Process' });

    await handleSetCallActivityVariables({
      diagramId,
      elementId: callId,
      inMappings: [{ source: 'orderId', target: 'id' }],
      outMappings: [{ source: 'result', target: 'subResult' }],
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('orderId');
    expect(names).toContain('id');
    expect(names).toContain('result');
    expect(names).toContain('subResult');
  });

  test('extracts variables from form field defaultValue expressions', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter' });

    await handleSetFormData({
      diagramId,
      elementId: taskId,
      fields: [
        {
          id: 'amount',
          label: 'Amount',
          type: 'string',
          defaultValue: '${defaultAmount}',
        },
      ],
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('amount');
    expect(names).toContain('defaultAmount');

    const defaultVar = res.variables.find((v: any) => v.name === 'defaultAmount');
    expect(defaultVar.readBy[0].source).toBe('formField.defaultValue');
  });

  test('extracts variables from loop with expression collection', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });

    await handleSetLoopCharacteristics({
      diagramId,
      elementId: taskId,
      loopType: 'sequential',
      collection: '${myList}',
      elementVariable: 'item',
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('myList');
    expect(names).toContain('item');
  });

  test('extracts variables from call activity sourceExpression', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Call' });

    await handleSetCallActivityVariables({
      diagramId,
      elementId: callId,
      inMappings: [{ sourceExpression: '${orderId + 1}', target: 'processedId' }],
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('orderId');
    expect(names).toContain('processedId');
  });

  test('deduplicates same variable read from multiple elements', async () => {
    const diagramId = await createDiagram();
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Yes' });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'No' });

    await connect(diagramId, gw, taskA, { conditionExpression: '${status == "approved"}' });
    await connect(diagramId, gw, taskB, { conditionExpression: '${status == "rejected"}' });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const statusVar = res.variables.find((v: any) => v.name === 'status');
    expect(statusVar).toBeDefined();
    // Should be read by both flows
    expect(statusVar.readBy.length).toBe(2);
  });

  test('handles diagram with no variables gracefully', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.variableCount).toBe(0);
    expect(res.referenceCount).toBe(0);
    expect(res.variables).toEqual([]);
  });
});
