import { describe, test, expect, beforeEach } from 'vitest';
import { handleCloneDiagram, handleListElements } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('clone_bpmn_diagram', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates a copy with a new ID', async () => {
    const diagramId = await createDiagram('Original');
    await addElement(diagramId, 'bpmn:Task', { name: 'My Task' });

    const res = parseResult(await handleCloneDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.diagramId).not.toBe(diagramId);
    expect(res.clonedFrom).toBe(diagramId);

    // Cloned diagram should have the same elements
    const origList = parseResult(await handleListElements({ diagramId }));
    const cloneList = parseResult(await handleListElements({ diagramId: res.diagramId }));
    expect(cloneList.count).toBe(origList.count);
  });

  test('allows overriding the name', async () => {
    const diagramId = await createDiagram('Original');
    const res = parseResult(await handleCloneDiagram({ diagramId, name: 'Clone' }));
    expect(res.name).toBe('Clone');
  });
});
