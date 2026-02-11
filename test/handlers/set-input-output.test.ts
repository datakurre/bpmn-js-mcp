import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetInputOutput, handleExportBpmn, handleGetProperties } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('handleSetInputOutput', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets input/output parameters on a task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'External',
    });

    const res = parseResult(
      await handleSetInputOutput({
        diagramId,
        elementId: taskId,
        inputParameters: [
          { name: 'orderId', value: '123' },
          { name: 'amount', value: '${order.total}' },
        ],
        outputParameters: [{ name: 'result', value: 'ok' }],
      })
    );
    expect(res.success).toBe(true);
    expect(res.inputParameterCount).toBe(2);
    expect(res.outputParameterCount).toBe(1);

    // Verify it shows up in XML
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:inputOutput');
    expect(xml).toContain('orderId');
  });

  test('works with get_element_properties', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'IO Task',
    });

    await handleSetInputOutput({
      diagramId,
      elementId: taskId,
      inputParameters: [{ name: 'var1', value: 'val1' }],
    });

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    expect(props.extensionElements).toBeDefined();
    const io = props.extensionElements.find((e: any) => e.type === 'camunda:InputOutput');
    expect(io).toBeDefined();
    expect(io.inputParameters[0].name).toBe('var1');
  });
});

describe('handleSetInputOutput — value expressions', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('produces correct XML for expression values', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Expr Test',
    });

    await handleSetInputOutput({
      diagramId,
      elementId: taskId,
      inputParameters: [{ name: 'myInput', value: '${processVariable}' }],
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    // Should produce body text content, not a source attribute
    expect(xml).toContain('${processVariable}');
    expect(xml).not.toMatch(/source="/);
  });

  test('does not accept source or sourceExpression attributes', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'No Source',
    });

    // Even if someone passes source-like data as value, it should just set value
    await handleSetInputOutput({
      diagramId,
      elementId: taskId,
      inputParameters: [{ name: 'var1', value: 'static' }],
    });

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const io = props.extensionElements.find((e: any) => e.type === 'camunda:InputOutput');
    expect(io.inputParameters[0].value).toBe('static');
  });
});
