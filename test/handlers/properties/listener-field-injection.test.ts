import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleSetCamundaListeners,
  handleExportBpmn,
  handleGetProperties,
} from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('set_bpmn_camunda_listeners — field injection', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets fields on execution listener', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        executionListeners: [
          {
            event: 'start',
            class: 'com.example.MyListener',
            fields: [
              { name: 'url', stringValue: 'https://example.com' },
              { name: 'expr', expression: '${env.apiKey}' },
            ],
          },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.executionListenerCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:executionListener');
    expect(xml).toContain('camunda:field');
    expect(xml).toContain('url');
    expect(xml).toContain('https://example.com');
    expect(xml).toContain('${env.apiKey}');
  });

  test('sets fields on task listener', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        taskListeners: [
          {
            event: 'create',
            class: 'com.example.TaskNotifier',
            fields: [{ name: 'channel', string: 'email' }],
          },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.taskListenerCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:taskListener');
    expect(xml).toContain('camunda:field');
    expect(xml).toContain('channel');
  });

  test('fields are serialized in get_bpmn_element_properties', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Svc' });

    await handleSetCamundaListeners({
      diagramId,
      elementId: taskId,
      executionListeners: [
        {
          event: 'end',
          delegateExpression: '${myDelegate}',
          fields: [
            { name: 'timeout', stringValue: '30' },
            { name: 'retryExpr', expression: '${config.retries}' },
          ],
        },
      ],
    });

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const listeners = props.extensionElements.filter(
      (e: any) => e.type === 'camunda:ExecutionListener'
    );
    expect(listeners).toHaveLength(1);
    expect(listeners[0].fields).toHaveLength(2);
    expect(listeners[0].fields[0]).toEqual({ name: 'timeout', stringValue: '30' });
    expect(listeners[0].fields[1]).toEqual({ name: 'retryExpr', expression: '${config.retries}' });
  });
});
