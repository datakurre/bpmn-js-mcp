/**
 * Tests for diff_bpmn_diagrams — comprehensive coverage.
 *
 * Covers: position changes, connection changes, actual property changes
 * via clone, and edge cases.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleDiffDiagrams,
  handleCloneDiagram,
  handleMoveElement,
  handleSetProperties,
  handleDeleteElement,
} from '../../../src/handlers';
import { createDiagram, addElement, connect, parseResult, clearDiagrams } from '../../helpers';

describe('diff_bpmn_diagrams — comprehensive', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('detects name change on same element via clone', async () => {
    const idA = await createDiagram('Base');
    const taskId = await addElement(idA, 'bpmn:UserTask', { name: 'Original' });

    // Clone diagram A to get same element IDs
    const cloneRes = parseResult(await handleCloneDiagram({ diagramId: idA }));
    const idB = cloneRes.diagramId;

    // Rename the task in diagram B
    await handleSetProperties({
      diagramId: idB,
      elementId: taskId,
      properties: { name: 'Renamed' },
    });

    const res = parseResult(await handleDiffDiagrams({ diagramIdA: idA, diagramIdB: idB }));
    expect(res.success).toBe(true);
    expect(res.summary.changedCount).toBeGreaterThanOrEqual(1);

    const taskChange = res.changed.find((c: any) => c.elementId === taskId);
    expect(taskChange).toBeDefined();
    const nameChange = taskChange.changes.find((ch: any) => ch.property === 'name');
    expect(nameChange).toBeDefined();
    expect(nameChange.oldValue).toBe('Original');
    expect(nameChange.newValue).toBe('Renamed');
  });

  test('detects position change on same element via clone', async () => {
    const idA = await createDiagram('Base');
    const taskId = await addElement(idA, 'bpmn:UserTask', { name: 'Task', x: 100, y: 100 });

    const cloneRes = parseResult(await handleCloneDiagram({ diagramId: idA }));
    const idB = cloneRes.diagramId;

    // Move the task in diagram B
    await handleMoveElement({ diagramId: idB, elementId: taskId, x: 500, y: 400 });

    const res = parseResult(await handleDiffDiagrams({ diagramIdA: idA, diagramIdB: idB }));
    const taskChange = res.changed.find((c: any) => c.elementId === taskId);
    expect(taskChange).toBeDefined();
    const posChange = taskChange.changes.find((ch: any) => ch.property === 'position');
    expect(posChange).toBeDefined();
  });

  test('detects connection changes via clone', async () => {
    const idA = await createDiagram('Base');
    const start = await addElement(idA, 'bpmn:StartEvent');
    const task = await addElement(idA, 'bpmn:UserTask', { name: 'Task' });
    await connect(idA, start, task);

    const cloneRes = parseResult(await handleCloneDiagram({ diagramId: idA }));
    const idB = cloneRes.diagramId;

    // Add an end event and connect in B
    const endId = await addElement(idB, 'bpmn:EndEvent');
    await connect(idB, task, endId);

    const res = parseResult(await handleDiffDiagrams({ diagramIdA: idA, diagramIdB: idB }));

    // There should be at least additions (end event + flow)
    expect(res.summary.addedCount).toBeGreaterThanOrEqual(1);

    // The task should have changed connections (new outgoing)
    const taskChange = res.changed.find((c: any) => c.elementId === task);
    expect(taskChange).toBeDefined();
  });

  test('reports identical for cloned diagram without changes', async () => {
    const idA = await createDiagram('Base');
    await addElement(idA, 'bpmn:StartEvent', { name: 'Start' });

    const cloneRes = parseResult(await handleCloneDiagram({ diagramId: idA }));
    const idB = cloneRes.diagramId;

    const res = parseResult(await handleDiffDiagrams({ diagramIdA: idA, diagramIdB: idB }));
    expect(res.summary.identical).toBe(true);
  });

  test('detects removed element via clone and delete', async () => {
    const idA = await createDiagram('Base');
    await addElement(idA, 'bpmn:StartEvent', { name: 'Start' });
    const taskId = await addElement(idA, 'bpmn:UserTask', { name: 'To Remove' });

    const cloneRes = parseResult(await handleCloneDiagram({ diagramId: idA }));
    const idB = cloneRes.diagramId;

    // Delete the task in diagram B
    await handleDeleteElement({ diagramId: idB, elementId: taskId });

    const res = parseResult(await handleDiffDiagrams({ diagramIdA: idA, diagramIdB: idB }));
    expect(res.summary.removedCount).toBeGreaterThanOrEqual(1);
    expect(res.removed.some((r: any) => r.id === taskId)).toBe(true);
  });

  test('throws for missing diagramIdA', async () => {
    const idB = await createDiagram();
    await expect(
      handleDiffDiagrams({ diagramIdA: undefined as any, diagramIdB: idB })
    ).rejects.toThrow(/Missing required/);
  });

  test('throws for nonexistent diagram', async () => {
    const idA = await createDiagram();
    await expect(
      handleDiffDiagrams({ diagramIdA: idA, diagramIdB: 'nonexistent' })
    ).rejects.toThrow(/Diagram not found/);
  });
});
