import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetProperties, handleExportBpmn } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('handleSetProperties', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets camunda properties on an element', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
    });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        properties: { 'camunda:assignee': 'john' },
      })
    );
    expect(res.success).toBe(true);
    expect(res.updatedProperties).toContain('camunda:assignee');

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:assignee');
  });

  test('throws for unknown element', async () => {
    const diagramId = await createDiagram();
    await expect(
      handleSetProperties({
        diagramId,
        elementId: 'ghost',
        properties: { name: 'x' },
      })
    ).rejects.toThrow(/Element not found/);
  });
});
