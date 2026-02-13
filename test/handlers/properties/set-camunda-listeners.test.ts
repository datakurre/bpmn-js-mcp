import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetCamundaListeners, handleExportBpmn } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('set_bpmn_camunda_listeners', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets execution listeners on a service task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        executionListeners: [
          { event: 'start', class: 'com.example.StartListener' },
          { event: 'end', delegateExpression: '${endListener}' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.executionListenerCount).toBe(2);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:executionListener');
    expect(xml).toContain('com.example.StartListener');
    expect(xml).toContain('${endListener}');
  });

  test('sets task listeners on a user task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        taskListeners: [{ event: 'create', expression: '${taskService.onCreated(task)}' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.taskListenerCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:taskListener');
  });

  test('rejects task listeners on non-UserTask', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Auto' });

    await expect(
      handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        taskListeners: [{ event: 'create', class: 'com.example.Nope' }],
      })
    ).rejects.toThrow(/UserTask/);
  });

  test('sets task listener with id attribute', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        taskListeners: [
          {
            event: 'create',
            id: 'myListener1',
            class: 'com.example.CreateListener',
          },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.taskListenerCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:taskListener');
    expect(xml).toContain('id="myListener1"');
  });

  test('sets task listener with timeout timer event definition', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        taskListeners: [
          {
            event: 'timeout',
            id: 'timeoutListener',
            class: 'com.example.TimeoutHandler',
            timerEventDefinition: { timeDuration: 'PT1H' },
          },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.taskListenerCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:taskListener');
    expect(xml).toContain('event="timeout"');
    expect(xml).toContain('id="timeoutListener"');
    expect(xml).toContain('timerEventDefinition');
    expect(xml).toContain('PT1H');
  });

  test('sets task listener with timeCycle timer event definition', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Wait' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        taskListeners: [
          {
            event: 'timeout',
            id: 'reminderListener',
            expression: '${reminderService.send(task)}',
            timerEventDefinition: { timeCycle: 'R3/PT10M' },
          },
        ],
      })
    );

    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('R3/PT10M');
    expect(xml).toContain('timeCycle');
  });

  test('requires at least one listener', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'X' });

    await expect(
      handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
      })
    ).rejects.toThrow(/at least one/i);
  });
});
