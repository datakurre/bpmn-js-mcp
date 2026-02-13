import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetInputOutput, handleExportBpmn, handleGetProperties } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('set_bpmn_input_output_mapping — complex value types', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets list value on input parameter', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'ListTask' });

    const res = parseResult(
      await handleSetInputOutput({
        diagramId,
        elementId: taskId,
        inputParameters: [{ name: 'recipients', list: ['alice', 'bob', 'charlie'] }],
      })
    );
    expect(res.success).toBe(true);
    expect(res.inputParameterCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:list');
    expect(xml).toContain('alice');
    expect(xml).toContain('bob');
    expect(xml).toContain('charlie');
  });

  test('sets map value on input parameter', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'MapTask' });

    const res = parseResult(
      await handleSetInputOutput({
        diagramId,
        elementId: taskId,
        inputParameters: [
          { name: 'headers', map: { 'Content-Type': 'application/json', Accept: 'text/plain' } },
        ],
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:map');
    expect(xml).toContain('camunda:entry');
    expect(xml).toContain('Content-Type');
    expect(xml).toContain('application/json');
  });

  test('sets script value on input parameter', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'ScriptTask' });

    const res = parseResult(
      await handleSetInputOutput({
        diagramId,
        elementId: taskId,
        inputParameters: [
          {
            name: 'payload',
            script: {
              scriptFormat: 'groovy',
              value: 'return execution.getVariable("data")',
            },
          },
        ],
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:script');
    expect(xml).toContain('groovy');
    expect(xml).toContain('execution.getVariable');
  });

  test('complex values are serialized in get_bpmn_element_properties', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'PropTest' });

    await handleSetInputOutput({
      diagramId,
      elementId: taskId,
      inputParameters: [
        { name: 'items', list: ['a', 'b'] },
        { name: 'config', map: { key1: 'val1', key2: 'val2' } },
        { name: 'computed', script: { scriptFormat: 'javascript', value: 'return 42;' } },
      ],
      outputParameters: [{ name: 'result', value: '${output}' }],
    });

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const io = props.extensionElements.find((e: any) => e.type === 'camunda:InputOutput');
    expect(io).toBeDefined();

    // List
    const listParam = io.inputParameters.find((p: any) => p.name === 'items');
    expect(listParam.list).toEqual(['a', 'b']);

    // Map
    const mapParam = io.inputParameters.find((p: any) => p.name === 'config');
    expect(mapParam.map).toEqual({ key1: 'val1', key2: 'val2' });

    // Script
    const scriptParam = io.inputParameters.find((p: any) => p.name === 'computed');
    expect(scriptParam.script).toEqual({ scriptFormat: 'javascript', value: 'return 42;' });

    // Simple value still works
    const outputParam = io.outputParameters.find((p: any) => p.name === 'result');
    expect(outputParam.value).toBe('${output}');
  });
});
