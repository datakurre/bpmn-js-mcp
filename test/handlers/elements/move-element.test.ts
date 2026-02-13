import { describe, test, expect, beforeEach } from 'vitest';
import { handleMoveElement } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('move_bpmn_element', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('moves an element to new coordinates', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      x: 100,
      y: 100,
    });

    const res = parseResult(
      await handleMoveElement({ diagramId, elementId: taskId, x: 500, y: 400 })
    );
    expect(res.success).toBe(true);
    expect(res.position.x).toBe(500);
    expect(res.position.y).toBe(400);
  });
});
