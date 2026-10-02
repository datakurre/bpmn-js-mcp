import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement, handleDuplicateElement } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('add_bpmn_elements copyFrom — parity with duplicate_bpmn_element', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('copyFrom duplicates a task with its name and type', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review Order',
      x: 200,
      y: 200,
    });

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        copyFrom: taskId,
      })
    );

    expect(res.success).toBe(true);
    expect(res.newElementId || res.elementId).toBeTruthy();
    expect(res.elementType).toBe('bpmn:UserTask');
    // Name should contain 'copy' suffix
    expect(res.name).toContain('copy');
  });

  test('copyFrom produces same result as duplicate_bpmn_element', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Payment',
      x: 150,
      y: 150,
    });

    // Use copyFrom via add_bpmn_elements
    const copyRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        copyFrom: taskId,
      })
    );

    // Use duplicate_bpmn_element directly
    const dupRes = parseResult(
      await handleDuplicateElement({
        diagramId,
        elementId: taskId,
      })
    );

    // Both should succeed with same element type
    expect(copyRes.success).toBe(true);
    expect(dupRes.success).toBe(true);
    expect(copyRes.elementType).toBe(dupRes.elementType);
  });

  test('copyFrom on element without name works', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        copyFrom: eventId,
      })
    );

    expect(res.success).toBe(true);
    expect(res.elementType).toBe('bpmn:StartEvent');
  });

  test('copyFrom rejects non-existent source', async () => {
    const diagramId = await createDiagram();

    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        copyFrom: 'nonexistent',
      })
    ).rejects.toThrow();
  });
});
