import { describe, test, expect, beforeEach } from 'vitest';
import { handleValidate, handleSetProperties } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';

describe('validate_bpmn_diagram', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns about missing start/end events on empty diagram', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(await handleValidate({ diagramId }));
    expect(res.issues.some((i: any) => i.message.includes('start event'))).toBe(true);
    expect(res.issues.some((i: any) => i.message.includes('end event'))).toBe(true);
  });

  test('warns about disconnected elements', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Task', { name: 'Lonely' });
    const res = parseResult(await handleValidate({ diagramId }));
    expect(
      res.issues.some(
        (i: any) => i.message.includes('not connected') || i.rule === 'no-disconnected'
      )
    ).toBe(true);
  });

  test('warns about unnamed tasks', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Task');
    const res = parseResult(await handleValidate({ diagramId }));
    expect(
      res.issues.some(
        (i: any) => i.message.includes('missing label') || i.rule === 'label-required'
      )
    ).toBe(true);
  });

  test('no start/end warnings when both present and connected', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      x: 100,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      x: 300,
      y: 100,
    });
    await connect(diagramId, startId, endId);

    const res = parseResult(await handleValidate({ diagramId }));
    expect(res.issues.some((i: any) => i.message.includes('No start event'))).toBe(false);
    expect(res.issues.some((i: any) => i.message.includes('No end event'))).toBe(false);
  });
});

describe('validate_bpmn_diagram — external task validation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when camunda:topic is set without camunda:type=external', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Bad External',
    });
    // Manually set only topic without type (bypass auto-set by using type directly)
    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        'camunda:type': 'external',
        'camunda:topic': 'my-topic',
      },
    });
    // Now change type to something else
    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        'camunda:type': 'connector',
      },
    });

    const res = parseResult(await handleValidate({ diagramId }));
    expect(res.issues.some((i: any) => i.message.includes('camunda:topic'))).toBe(true);
  });
});

describe('validate_bpmn_diagram — gateway default flow warning', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when exclusive gateway has conditional flows but no default', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      x: 100,
      y: 200,
    });
    const gwId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Check',
      x: 250,
      y: 200,
    });
    const taskAId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Yes',
      x: 400,
      y: 100,
    });
    const taskBId = await addElement(diagramId, 'bpmn:Task', {
      name: 'No',
      x: 400,
      y: 300,
    });

    await connect(diagramId, startId, gwId);
    await connect(diagramId, gwId, taskAId, { conditionExpression: '${yes}' });
    await connect(diagramId, gwId, taskBId, { conditionExpression: '${!yes}' });

    const res = parseResult(await handleValidate({ diagramId }));
    expect(res.issues.some((i: any) => i.message.includes('default flow'))).toBe(true);
  });
});
