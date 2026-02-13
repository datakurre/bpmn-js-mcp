import { describe, test, expect, beforeEach } from 'vitest';
import { handleDeleteElement, handleListElements } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('delete_bpmn_element', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('removes an element from the diagram', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'To delete',
    });

    const res = parseResult(await handleDeleteElement({ diagramId, elementId: taskId }));
    expect(res.success).toBe(true);

    // Element should no longer appear in list
    const list = parseResult(await handleListElements({ diagramId }));
    expect(list.elements.find((e: any) => e.id === taskId)).toBeUndefined();
  });

  test('throws for unknown element', async () => {
    const diagramId = await createDiagram();
    await expect(handleDeleteElement({ diagramId, elementId: 'ghost' })).rejects.toThrow(
      /Element not found/
    );
  });

  test('should delete multiple elements at once (bulk mode)', async () => {
    const diagramId = await createDiagram('bulk-delete');

    const id1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T1' });
    const id2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T2', x: 300, y: 100 });
    const id3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T3', x: 500, y: 100 });

    const deleteResult = parseResult(
      await handleDeleteElement({
        diagramId,
        elementId: '', // ignored in bulk mode
        elementIds: [id1, id2, id3],
      } as any)
    );
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.deletedCount).toBe(3);
    expect(deleteResult.deletedIds).toContain(id1);
    expect(deleteResult.deletedIds).toContain(id2);
    expect(deleteResult.deletedIds).toContain(id3);
  });

  test('should handle partial not-found in bulk delete', async () => {
    const diagramId = await createDiagram('bulk-partial');

    const id1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Exists' });

    const deleteResult = parseResult(
      await handleDeleteElement({
        diagramId,
        elementId: '',
        elementIds: [id1, 'nonexistent_id'],
      } as any)
    );
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.deletedCount).toBe(1);
    expect(deleteResult.notFound).toContain('nonexistent_id');
  });

  test('should reject when all elements not found in bulk delete', async () => {
    const diagramId = await createDiagram('bulk-all-missing');

    await expect(
      handleDeleteElement({
        diagramId,
        elementId: '',
        elementIds: ['nonexistent_1', 'nonexistent_2'],
      } as any)
    ).rejects.toThrow(/None of the specified elements/);
  });
});
