import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetCallActivityVariables, handleExportBpmn } from '../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../helpers';

describe('handleSetCallActivityVariables', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets in/out variable mappings on a CallActivity', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Subprocess' });

    const res = parseResult(
      await handleSetCallActivityVariables({
        diagramId,
        elementId: callId,
        inMappings: [
          { source: 'orderId', target: 'inputOrderId' },
          { sourceExpression: '${customer.name}', target: 'customerName' },
        ],
        outMappings: [{ source: 'result', target: 'subprocessResult' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.inMappingCount).toBe(2);
    expect(res.outMappingCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:in');
    expect(xml).toContain('camunda:out');
    expect(xml).toContain('orderId');
    expect(xml).toContain('subprocessResult');
  });

  test('supports variables="all" shorthand', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Sub' });

    const res = parseResult(
      await handleSetCallActivityVariables({
        diagramId,
        elementId: callId,
        inMappings: [{ variables: 'all' }],
        outMappings: [{ variables: 'all' }],
      })
    );

    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('variables="all"');
  });

  test('rejects on non-CallActivity elements', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    await expect(
      handleSetCallActivityVariables({
        diagramId,
        elementId: taskId,
        inMappings: [{ source: 'x', target: 'y' }],
      })
    ).rejects.toThrow(/CallActivity/);
  });

  test('requires at least one mapping', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Sub' });

    await expect(
      handleSetCallActivityVariables({
        diagramId,
        elementId: callId,
      })
    ).rejects.toThrow(/at least one/i);
  });
});
