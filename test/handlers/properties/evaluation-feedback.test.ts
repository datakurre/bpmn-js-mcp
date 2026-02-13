/**
 * Tests for MCP evaluation feedback improvements:
 * - replace_bpmn_element: boundary event guard
 * - add_bpmn_element: visual boundary event feedback
 * - export_bpmn: skipLint abuse warning
 * - linter: enriched error context for boundary events
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleReplaceElement, handleExportBpmn, handleAddElement } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';

describe('replace_bpmn_element — boundary event guard', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('rejects replacing an element TO bpmn:BoundaryEvent with helpful error', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'My Task' });

    await expect(
      handleReplaceElement({
        diagramId,
        elementId: taskId,
        newType: 'bpmn:BoundaryEvent',
      })
    ).rejects.toThrow(/Cannot replace an element to bpmn:BoundaryEvent/);
  });

  test('error message suggests using add_bpmn_element with hostElementId', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'My Task' });

    await expect(
      handleReplaceElement({
        diagramId,
        elementId: taskId,
        newType: 'bpmn:BoundaryEvent',
      })
    ).rejects.toThrow(/add_bpmn_element.*hostElementId/);
  });

  test('rejects replacing FROM a BoundaryEvent with helpful error', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Host Task',
      x: 200,
      y: 200,
    });
    const boundaryId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      hostElementId: taskId,
      x: 220,
      y: 260,
    });

    await expect(
      handleReplaceElement({
        diagramId,
        elementId: boundaryId,
        newType: 'bpmn:EndEvent',
      })
    ).rejects.toThrow(/Cannot replace a BoundaryEvent/);
  });

  test('still allows normal type replacement (Task → UserTask)', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'My Task' });

    const result = parseResult(
      await handleReplaceElement({
        diagramId,
        elementId: taskId,
        newType: 'bpmn:UserTask',
      })
    );
    expect(result.success).toBe(true);
    expect(result.newType).toBe('bpmn:UserTask');
  });
});

describe('add_bpmn_element — visual boundary event feedback', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('includes host element info when creating a boundary event', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Payment',
      x: 200,
      y: 200,
    });

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: taskId,
        x: 220,
        y: 260,
      })
    );

    expect(result.success).toBe(true);
    expect(result.attachedTo).toBeDefined();
    expect(result.attachedTo.hostElementId).toBe(taskId);
    expect(result.attachedTo.hostElementType).toBe('bpmn:ServiceTask');
    expect(result.attachedTo.hostElementName).toBe('Process Payment');
  });

  test('message confirms boundary event attachment', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
      x: 200,
      y: 200,
    });

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: taskId,
        x: 220,
        y: 260,
      })
    );

    expect(result.message).toContain('attached to');
    expect(result.message).toContain('Review');
  });

  test('does NOT include attachedTo for regular elements', async () => {
    const diagramId = await createDiagram();
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'My Task',
      })
    );

    expect(result.attachedTo).toBeUndefined();
  });
});

describe('export_bpmn — skipLint abuse warning', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when skipLint bypasses error-level issues', async () => {
    const diagramId = await createDiagram();
    // Invalid diagram: start event with no end event → lint errors
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start', x: 100, y: 100 });

    const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });

    // Should still export the XML
    expect(res.content[0].text).toContain('<bpmn:definitions');

    // But should include a skipLint warning
    const allText = res.content.map((c: any) => c.text).join('\n');
    expect(allText).toContain('skipLint bypassed');
    expect(allText).toContain('error');
  });

  test('no skipLint warning when diagram is valid', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 100,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 300, y: 100 });
    await connect(diagramId, start, end);

    const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const allText = res.content.map((c: any) => c.text).join('\n');
    expect(allText).not.toContain('skipLint bypassed');
  });
});
