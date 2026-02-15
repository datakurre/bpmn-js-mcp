import { describe, test, expect, beforeEach, vi } from 'vitest';
import { dispatchToolCall } from '../../../src/handlers';
import { parseResult, clearDiagrams, createDiagram, addElement, connect } from '../../helpers';
import type { ToolContext } from '../../../src/types';

describe('progress notifications', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('import_bpmn_xml emits progress when context has sendProgress', async () => {
    const progressCalls: Array<{ progress: number; total?: number; message?: string }> = [];
    const context: ToolContext = {
      sendProgress: vi.fn(async (progress, total, message) => {
        progressCalls.push({ progress, total, message });
      }),
    };

    const simpleXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
  </bpmn:process>
</bpmn:definitions>`;

    const res = parseResult(
      await dispatchToolCall('import_bpmn_xml', { xml: simpleXml, autoLayout: true }, context)
    );
    expect(res.success).toBe(true);
    expect(progressCalls.length).toBeGreaterThan(0);
    // Progress values should increase
    for (let i = 1; i < progressCalls.length; i++) {
      expect(progressCalls[i].progress).toBeGreaterThanOrEqual(progressCalls[i - 1].progress);
    }
  });

  test('layout_bpmn_diagram emits progress when context has sendProgress', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent');
    const taskId = await addElement(diagramId, 'bpmn:Task', 'Do Work', startId);
    const endId = await addElement(diagramId, 'bpmn:EndEvent', undefined, taskId);
    await connect(diagramId, startId, taskId);
    await connect(diagramId, taskId, endId);

    const progressCalls: Array<{ progress: number; total?: number; message?: string }> = [];
    const context: ToolContext = {
      sendProgress: vi.fn(async (progress, total, message) => {
        progressCalls.push({ progress, total, message });
      }),
    };

    const res = parseResult(await dispatchToolCall('layout_bpmn_diagram', { diagramId }, context));
    expect(res.success).toBe(true);
    expect(progressCalls.length).toBeGreaterThan(0);
  });

  test('handlers work without context (backward compatible)', async () => {
    const res = parseResult(await dispatchToolCall('create_bpmn_diagram', { name: 'Test' }));
    expect(res.success).toBe(true);
  });

  test('handlers work with empty context', async () => {
    const context: ToolContext = {};
    const res = parseResult(
      await dispatchToolCall('create_bpmn_diagram', { name: 'Test' }, context)
    );
    expect(res.success).toBe(true);
  });
});
