import { describe, it, expect, beforeEach } from 'vitest';
import { handleDuplicateElement } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('handleDuplicateElement', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('duplicates a task with its name', async () => {
    const diagramId = await createDiagram('Duplicate Test');
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review Order',
      x: 200,
      y: 200,
    });

    const res = parseResult(await handleDuplicateElement({ diagramId, elementId: taskId }));

    expect(res.success).toBe(true);
    expect(res.originalElementId).toBe(taskId);
    expect(res.newElementId).toBeTruthy();
    expect(res.newElementId).not.toBe(taskId);
    expect(res.elementType).toBe('bpmn:UserTask');
    expect(res.name).toContain('copy');

    // Verify the new element exists
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const newEl = reg.get(res.newElementId);
    expect(newEl).toBeTruthy();
    expect(newEl.type).toBe('bpmn:UserTask');
  });

  it('duplicates with custom offset', async () => {
    const diagramId = await createDiagram('Offset Test');
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process',
      x: 100,
      y: 100,
    });

    const res = parseResult(
      await handleDuplicateElement({
        diagramId,
        elementId: taskId,
        offsetX: 200,
        offsetY: 100,
      })
    );

    expect(res.success).toBe(true);
    expect(res.position).toBeDefined();
  });

  it('duplicates an element without a name', async () => {
    const diagramId = await createDiagram('No Name');
    const eventId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });

    const res = parseResult(await handleDuplicateElement({ diagramId, elementId: eventId }));

    expect(res.success).toBe(true);
    expect(res.elementType).toBe('bpmn:StartEvent');
  });

  it('rejects duplicating a participant', async () => {
    const diagramId = await createDiagram('Participant');
    const partId = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 300,
      y: 200,
    });

    await expect(handleDuplicateElement({ diagramId, elementId: partId })).rejects.toThrow(
      /Cannot duplicate/
    );
  });

  it('rejects non-existent element', async () => {
    const diagramId = await createDiagram('Missing');

    await expect(handleDuplicateElement({ diagramId, elementId: 'nonexistent' })).rejects.toThrow();
  });
});
