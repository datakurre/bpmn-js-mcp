/**
 * Tests for resize_bpmn_element tool (merged into move_bpmn_element).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleMoveElement } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('resize_bpmn_element', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('resizes a subprocess', async () => {
    const diagramId = await createDiagram();
    const subId = await addElement(diagramId, 'bpmn:SubProcess', {
      name: 'My Sub',
      x: 200,
      y: 200,
    });

    const res = parseResult(
      await handleMoveElement({
        diagramId,
        elementId: subId,
        width: 500,
        height: 300,
      })
    );

    expect(res.success).toBe(true);
    expect(res.newSize.width).toBe(500);
    expect(res.newSize.height).toBe(300);

    // Verify the element was actually resized
    const diagram = getDiagram(diagramId)!;
    const element = diagram.modeler.get('elementRegistry').get(subId);
    expect(element.width).toBe(500);
    expect(element.height).toBe(300);
  });

  test('resizes a text annotation', async () => {
    const diagramId = await createDiagram();
    const annotId = await addElement(diagramId, 'bpmn:TextAnnotation', {
      name: 'Note',
      x: 100,
      y: 100,
    });

    const res = parseResult(
      await handleMoveElement({
        diagramId,
        elementId: annotId,
        width: 200,
        height: 80,
      })
    );

    expect(res.success).toBe(true);
  });

  test('throws when element not found', async () => {
    const diagramId = await createDiagram();

    await expect(
      handleMoveElement({
        diagramId,
        elementId: 'nonexistent',
        width: 100,
        height: 100,
      })
    ).rejects.toThrow(/Element not found/);
  });
});
