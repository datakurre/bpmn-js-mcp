/**
 * Tests for resize_bpmn_element tool.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleResizeElement } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('resize_bpmn_element', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('resizes a subprocess', async () => {
    const diagramId = await createDiagram();
    const subId = await addElement(diagramId, 'bpmn:SubProcess', {
      name: 'My Sub',
      x: 200,
      y: 200,
    });

    const res = parseResult(
      await handleResizeElement({
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

  it('resizes a text annotation', async () => {
    const diagramId = await createDiagram();
    const annotId = await addElement(diagramId, 'bpmn:TextAnnotation', {
      name: 'Note',
      x: 100,
      y: 100,
    });

    const res = parseResult(
      await handleResizeElement({
        diagramId,
        elementId: annotId,
        width: 200,
        height: 80,
      })
    );

    expect(res.success).toBe(true);
  });

  it('throws when element not found', async () => {
    const diagramId = await createDiagram();

    await expect(
      handleResizeElement({
        diagramId,
        elementId: 'nonexistent',
        width: 100,
        height: 100,
      })
    ).rejects.toThrow(/Element not found/);
  });
});
