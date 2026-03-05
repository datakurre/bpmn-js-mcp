/**
 * TDD tests for the implicit-merge warning emitted by connect_bpmn_elements.
 *
 * When a sequence flow is created and the target element (non-gateway) ends up
 * with ≥ 2 incoming flows, the handler should append a targeted warning to the
 * response immediately — before the bpmnlint pass.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleConnect } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../../helpers';

describe('connect_bpmn_elements — implicit-merge warning', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('emits no warning when target has only 1 incoming flow', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Do Work', x: 300, y: 100 });

    const result = await handleConnect({
      diagramId,
      sourceElementId: startId,
      targetElementId: taskId,
    });

    const text = result.content.map((c: any) => c.text ?? '').join('\n');
    expect(text).not.toContain('implicit merge');
    expect(text).not.toContain('incoming flows without a merge gateway');
  });

  test('emits warning when a task gains 2 incoming flows', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const retryId = await addElement(diagramId, 'bpmn:Task', { name: 'Retry', x: 100, y: 250 });
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Charge Payment',
      x: 300,
      y: 100,
    });

    // First incoming flow — no warning
    await connect(diagramId, startId, taskId);

    // Second incoming flow — should warn
    const result = await handleConnect({
      diagramId,
      sourceElementId: retryId,
      targetElementId: taskId,
    });

    const text = result.content.map((c: any) => c.text ?? '').join('\n');
    expect(text).toContain('incoming flows without a merge gateway');
    expect(text).toContain('Charge Payment');
  });

  test('does NOT warn when the target is a gateway', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const retryId = await addElement(diagramId, 'bpmn:Task', { name: 'Retry', x: 100, y: 250 });
    const gwId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Merge?',
      x: 300,
      y: 100,
    });

    await connect(diagramId, startId, gwId);

    // Second flow into a gateway — no warning (gateway is designed for merge)
    const result = await handleConnect({
      diagramId,
      sourceElementId: retryId,
      targetElementId: gwId,
    });

    const text = result.content.map((c: any) => c.text ?? '').join('\n');
    expect(text).not.toContain('incoming flows without a merge gateway');
  });

  test('warning includes flowId hint for fix', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const retryId = await addElement(diagramId, 'bpmn:Task', { name: 'Retry', x: 100, y: 250 });
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Charge Payment',
      x: 300,
      y: 100,
    });
    await connect(diagramId, startId, taskId);

    const result = await handleConnect({
      diagramId,
      sourceElementId: retryId,
      targetElementId: taskId,
    });

    const text = result.content.map((c: any) => c.text ?? '').join('\n');
    expect(text).toContain('flowId');
  });
});
