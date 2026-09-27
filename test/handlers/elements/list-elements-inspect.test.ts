/**
 * Tests for list_bpmn_elements' `elementIds` inspect mode (ADR-027) — the
 * former get_bpmn_element_properties, extended to several elements at once.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleListElements, handleSetProperties } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('list_bpmn_elements — elementIds (inspect mode)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('returns full property detail for one element, matching get_bpmn_element_properties shape', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { 'camunda:assignee': 'alice' },
    });

    const res = parseResult(await handleListElements({ diagramId, elementIds: [taskId] }));
    expect(res.success).toBe(true);
    expect(res.count).toBe(1);
    expect(res.elements).toHaveLength(1);
    const detail = res.elements[0];
    expect(detail.id).toBe(taskId);
    expect(detail.type).toBe('bpmn:UserTask');
    expect(detail.name).toBe('Review');
    expect(detail.camundaProperties['camunda:assignee']).toBe('alice');
  });

  test('inspects several elements in one call', async () => {
    const diagramId = await createDiagram();
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Notify' });

    const res = parseResult(await handleListElements({ diagramId, elementIds: [task1, task2] }));
    expect(res.count).toBe(2);
    expect(res.elements.map((e: any) => e.id)).toEqual([task1, task2]);
    expect(res.elements[0].type).toBe('bpmn:UserTask');
    expect(res.elements[1].type).toBe('bpmn:ServiceTask');
  });

  test('ignores other filters when elementIds is provided', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    const res = parseResult(
      await handleListElements({
        diagramId,
        elementIds: [taskId],
        elementType: 'bpmn:ServiceTask', // would exclude the UserTask if applied
        namePattern: 'no-match',
      })
    );
    expect(res.count).toBe(1);
    expect(res.elements[0].id).toBe(taskId);
  });

  test('throws for an unknown element ID', async () => {
    const diagramId = await createDiagram();
    await expect(handleListElements({ diagramId, elementIds: ['ghost'] })).rejects.toThrow(
      /Element not found/
    );
  });
});
