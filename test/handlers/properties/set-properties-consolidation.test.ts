/**
 * Tests for set_bpmn_element_properties's Camunda-concern sub-objects
 * (inputOutput, formData, listeners, callActivityVariables, loop), added by
 * the consolidation in ADR-021 (#8). Each sub-object delegates to the same
 * handler the standalone (now hidden) tool used, so these tests focus on
 * the delegation/merging behavior in set-properties.ts rather than
 * re-testing each handler's own BPMN-modeling logic.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetProperties, handleExportBpmn, dispatchToolCall } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('set_bpmn_element_properties — Camunda sub-objects', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('inputOutput sub-object sets camunda:InputOutput', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Fetch' });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        inputOutput: { inputParameters: [{ name: 'url', value: 'https://x' }] },
      })
    );
    expect(res.success).toBe(true);
    expect(res.sections.inputOutput.inputParameterCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).toContain('camunda:inputOutput');
  });

  test('formData sub-object sets camunda:FormData', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        formData: { fields: [{ id: 'approved', label: 'Approved?', type: 'boolean' }] },
      })
    );
    expect(res.success).toBe(true);
    expect(res.sections.formData.fieldCount).toBe(1);
  });

  test('loop sub-object sets multi-instance loop characteristics', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Item' });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        loop: { loopType: 'parallel', collection: 'items', elementVariable: 'item' },
      })
    );
    expect(res.success).toBe(true);
    expect(res.sections.loop.loopType).toBe('parallel');

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).toContain('multiInstanceLoopCharacteristics');
  });

  test('listeners sub-object sets execution listeners', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        listeners: { executionListeners: [{ event: 'start', class: 'com.example.Listener' }] },
      })
    );
    expect(res.success).toBe(true);
    expect(res.sections.listeners.executionListenerCount).toBe(1);
  });

  test('callActivityVariables sub-object sets in/out mappings', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Sub Process' });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: callId,
        callActivityVariables: { inMappings: [{ source: 'orderId', target: 'orderId' }] },
      })
    );
    expect(res.success).toBe(true);
    expect(res.sections.callActivityVariables.inMappingCount).toBe(1);
  });

  test('combines properties and a sub-object in a single call', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        properties: { 'camunda:assignee': 'john' },
        formData: { fields: [{ id: 'notes', label: 'Notes', type: 'string' }] },
      })
    );
    expect(res.success).toBe(true);
    expect(res.updatedProperties).toContain('camunda:assignee');
    expect(res.updatedSections).toContain('formData');
    expect(res.message).toContain('properties');
    expect(res.message).toContain('formData');
  });

  test('combines two sub-objects in a single call', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        formData: { fields: [{ id: 'notes', label: 'Notes', type: 'string' }] },
        listeners: { taskListeners: [{ event: 'complete', delegateExpression: '${audit}' }] },
      })
    );
    expect(res.success).toBe(true);
    expect(res.updatedSections.sort()).toEqual(['formData', 'listeners']);
  });

  test('throws when neither properties, elementType, nor a sub-object is given', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    await expect(handleSetProperties({ diagramId, elementId: taskId })).rejects.toThrow(
      /properties/i
    );
  });

  test('hidden alias set_bpmn_input_output_mapping still dispatches to the same behavior', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Fetch' });

    const res = parseResult(
      await dispatchToolCall('set_bpmn_input_output_mapping', {
        diagramId,
        elementId: taskId,
        inputParameters: [{ name: 'url', value: 'https://x' }],
      })
    );
    expect(res.success).toBe(true);
    expect(res.inputParameterCount).toBe(1);
  });
});
