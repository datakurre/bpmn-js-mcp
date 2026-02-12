import { describe, test, expect, beforeEach } from 'vitest';
import { handleUndoChange, handleRedoChange, handleSetProperties } from '../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('bpmn_history', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('undo reverts the last change', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Original' });

    // Rename the task
    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { name: 'Renamed' },
    });

    // Verify rename happened
    const diagram = getDiagram(diagramId)!;
    const registry = diagram.modeler.get('elementRegistry');
    expect(registry.get(taskId).businessObject.name).toBe('Renamed');

    // Undo
    const undoRes = parseResult(await handleUndoChange({ diagramId }));
    expect(undoRes.success).toBe(true);
    expect(undoRes.canRedo).toBe(true);

    // Verify undo reverted the name
    expect(registry.get(taskId).businessObject.name).toBe('Original');
  });

  test('redo re-applies an undone change', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Original' });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { name: 'Renamed' },
    });

    await handleUndoChange({ diagramId });

    // Redo
    const redoRes = parseResult(await handleRedoChange({ diagramId }));
    expect(redoRes.success).toBe(true);

    // Verify redo re-applied the name
    const diagram = getDiagram(diagramId)!;
    const registry = diagram.modeler.get('elementRegistry');
    expect(registry.get(taskId).businessObject.name).toBe('Renamed');
  });

  test('undo reports nothing to undo on fresh diagram', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(await handleUndoChange({ diagramId }));
    expect(res.success).toBe(false);
    expect(res.message).toContain('Nothing to undo');
  });

  test('redo reports nothing to redo when no undo has been done', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(await handleRedoChange({ diagramId }));
    expect(res.success).toBe(false);
    expect(res.message).toContain('Nothing to redo');
  });
});
