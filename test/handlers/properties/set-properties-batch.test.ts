import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetProperties, handleBpmnHistory } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, exportXml, clearDiagrams } from '../../helpers';

describe('set_bpmn_element_properties — updates (batch form)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('applies properties to several elements in one call', async () => {
    const diagramId = await createDiagram();
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        updates: [
          { elementId: task1, properties: { 'camunda:assignee': 'john' } },
          { elementId: task2, properties: { 'camunda:assignee': 'jane' } },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.updated).toHaveLength(2);
    expect(res.updated.map((u: any) => u.elementId)).toEqual([task1, task2]);

    const xml = await exportXml(diagramId);
    expect(xml).toContain('camunda:assignee="john"');
    expect(xml).toContain('camunda:assignee="jane"');
  });

  test('applies elementType and sub-object concerns together within one item', async () => {
    const diagramId = await createDiagram();
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Do it' });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        updates: [
          {
            elementId: task,
            elementType: 'bpmn:UserTask',
            properties: { 'camunda:assignee': 'john' },
            formData: { fields: [{ id: 'note', label: 'Note', type: 'string' }] },
          },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.updated[0].changed).toEqual(
      expect.arrayContaining(['elementType', 'properties', 'formData'])
    );

    const xml = await exportXml(diagramId);
    expect(xml).toContain('userTask');
    expect(xml).toContain('camunda:assignee="john"');
    expect(xml).toContain('camunda:formData');
  });

  test('rejects when an item is missing every concern, without side effects on other items', async () => {
    const diagramId = await createDiagram();
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });

    await expect(
      handleSetProperties({
        diagramId,
        updates: [
          { elementId: task1, properties: { 'camunda:assignee': 'john' } },
          { elementId: task2 },
        ],
      })
    ).rejects.toThrow(/updates\[1\]/);

    const xml = await exportXml(diagramId);
    expect(xml).not.toContain('camunda:assignee="john"');
  });

  test('rejects an unknown elementId, applying nothing (all-or-nothing)', async () => {
    const diagramId = await createDiagram();
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    await expect(
      handleSetProperties({
        diagramId,
        updates: [
          { elementId: task1, properties: { 'camunda:assignee': 'john' } },
          { elementId: 'ghost', properties: { 'camunda:assignee': 'jane' } },
        ],
      })
    ).rejects.toThrow(/ghost/);

    const xml = await exportXml(diagramId);
    expect(xml).not.toContain('camunda:assignee="john"');
  });

  test('rejects a sub-object type mismatch before mutating anything', async () => {
    const diagramId = await createDiagram();
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const serviceTask = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Notify' });

    await expect(
      handleSetProperties({
        diagramId,
        updates: [
          { elementId: task1, properties: { 'camunda:assignee': 'john' } },
          // formData is only valid on UserTask/StartEvent, not ServiceTask
          {
            elementId: serviceTask,
            formData: { fields: [{ id: 'note', label: 'Note', type: 'string' }] },
          },
        ],
      })
    ).rejects.toThrow(/updates\[1\]/);

    const xml = await exportXml(diagramId);
    expect(xml).not.toContain('camunda:assignee="john"');
  });

  test('groups the whole batch into a single undo step', async () => {
    const diagramId = await createDiagram();
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });

    await handleSetProperties({
      diagramId,
      updates: [
        { elementId: task1, properties: { 'camunda:assignee': 'john' } },
        { elementId: task2, properties: { 'camunda:assignee': 'jane' } },
      ],
    });

    let xml = await exportXml(diagramId);
    expect(xml).toContain('camunda:assignee="john"');
    expect(xml).toContain('camunda:assignee="jane"');

    const undoResult = parseResult(
      await handleBpmnHistory({ diagramId, action: 'undo', steps: 1 })
    );
    expect(undoResult.stepsPerformed).toBe(1);

    xml = await exportXml(diagramId);
    expect(xml).not.toContain('camunda:assignee="john"');
    expect(xml).not.toContain('camunda:assignee="jane"');
  });

  test('rejects an empty updates array', async () => {
    const diagramId = await createDiagram();
    await expect(handleSetProperties({ diagramId, updates: [] })).rejects.toThrow();
  });
});
