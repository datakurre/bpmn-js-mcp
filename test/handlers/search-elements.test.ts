import { describe, test, expect, beforeEach } from 'vitest';
import { handleListElements as handleSearchElements } from '../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../helpers';

describe('handleSearchElements', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('searches by element type', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });

    const res = parseResult(
      await handleSearchElements({
        diagramId,
        elementType: 'bpmn:UserTask',
      })
    );

    expect(res.success).toBe(true);
    expect(res.count).toBe(2);
    expect(res.elements.every((e: any) => e.type === 'bpmn:UserTask')).toBe(true);
  });

  test('searches by name pattern', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Document' });
    await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Send Email' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Report' });

    const res = parseResult(
      await handleSearchElements({
        diagramId,
        namePattern: 'review',
      })
    );

    expect(res.success).toBe(true);
    expect(res.count).toBe(2);
  });

  test('combines type and name filters', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Doc' });
    await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Review Auto' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });

    const res = parseResult(
      await handleSearchElements({
        diagramId,
        elementType: 'bpmn:UserTask',
        namePattern: 'review',
      })
    );

    expect(res.count).toBe(1);
    expect(res.elements[0].name).toBe('Review Doc');
  });

  test('returns empty results for no matches', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    const res = parseResult(
      await handleSearchElements({
        diagramId,
        namePattern: 'nonexistent',
      })
    );

    expect(res.success).toBe(true);
    expect(res.count).toBe(0);
  });
});
