/**
 * Tests for move_bpmn_element combined operations.
 *
 * Covers: move+resize, error when no operation, partial moves (x-only, y-only).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleMoveElement } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('move_bpmn_element — combined operations', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('throws when no operation specified', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });

    await expect(handleMoveElement({ diagramId, elementId: taskId })).rejects.toThrow(
      /At least one of/
    );
  });

  test('moves with only x coordinate', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });

    const res = parseResult(await handleMoveElement({ diagramId, elementId: taskId, x: 300 }));
    expect(res.success).toBe(true);
    expect(res.position.x).toBe(300);
  });

  test('moves with only y coordinate', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });

    const res = parseResult(await handleMoveElement({ diagramId, elementId: taskId, y: 400 }));
    expect(res.success).toBe(true);
    expect(res.position.y).toBe(400);
  });

  test('combines move and resize in single call', async () => {
    const diagramId = await createDiagram();
    const subId = await addElement(diagramId, 'bpmn:SubProcess', {
      name: 'Sub',
      x: 100,
      y: 100,
    });

    const res = parseResult(
      await handleMoveElement({
        diagramId,
        elementId: subId,
        x: 300,
        y: 200,
        width: 500,
        height: 300,
      })
    );

    expect(res.success).toBe(true);
    expect(res.position).toBeDefined();
    expect(res.newSize.width).toBe(500);
    expect(res.newSize.height).toBe(300);
    expect(res.message).toContain('moved to');
    expect(res.message).toContain('resized to');
  });

  test('resize only preserves position', async () => {
    const diagramId = await createDiagram();
    const subId = await addElement(diagramId, 'bpmn:SubProcess', {
      name: 'Sub',
      x: 200,
      y: 200,
    });

    const diagram = getDiagram(diagramId)!;
    const el = diagram.modeler.get('elementRegistry').get(subId);
    const origX = el.x;
    const origY = el.y;

    const res = parseResult(
      await handleMoveElement({ diagramId, elementId: subId, width: 600, height: 400 })
    );

    expect(res.success).toBe(true);
    expect(res.newSize).toBeDefined();
    expect(res.position).toBeUndefined();

    // Element should still be at roughly the same position
    const updated = diagram.modeler.get('elementRegistry').get(subId);
    expect(updated.x).toBe(origX);
    expect(updated.y).toBe(origY);
  });

  test('moving to same position is a no-op', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { x: 200, y: 200 });

    const diagram = getDiagram(diagramId)!;
    const el = diagram.modeler.get('elementRegistry').get(taskId);

    const res = parseResult(
      await handleMoveElement({ diagramId, elementId: taskId, x: el.x, y: el.y })
    );
    expect(res.success).toBe(true);
  });

  test('throws for nonexistent element', async () => {
    const diagramId = await createDiagram();

    await expect(
      handleMoveElement({ diagramId, elementId: 'nope', x: 100, y: 100 })
    ).rejects.toThrow(/Element not found/);
  });

  test('throws for nonexistent diagram', async () => {
    await expect(handleMoveElement({ diagramId: 'nope', elementId: 'x', x: 100 })).rejects.toThrow(
      /Diagram not found/
    );
  });
});
