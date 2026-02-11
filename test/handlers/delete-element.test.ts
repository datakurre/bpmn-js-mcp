import { describe, test, expect, beforeEach } from 'vitest';
import { handleDeleteElement, handleListElements } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('handleDeleteElement', () => {
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
});
