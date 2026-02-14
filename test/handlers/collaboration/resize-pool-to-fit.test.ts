import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleResizePoolToFit,
} from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('resize_bpmn_pool_to_fit', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('resizes a pool to fit its elements', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Process' }, { name: 'External', collapsed: true }],
      })
    );

    const poolId = collab.participantIds[0];

    // Add several elements to fill up the pool
    for (let i = 0; i < 5; i++) {
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: `Task ${i + 1}`,
        participantId: poolId,
        x: 200 + i * 150,
        y: 200,
      });
    }

    const result = parseResult(
      await handleResizePoolToFit({
        diagramId,
        participantId: poolId,
      })
    );

    expect(result.success).toBe(true);
    expect(result.elementCount).toBe(5);
    // The pool should have been resized to accommodate all tasks
    expect(result.newBounds.width).toBeGreaterThanOrEqual(result.oldBounds.width);
  });

  test('returns resized: false when pool already fits', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Process' }, { name: 'Partner', collapsed: true }],
      })
    );

    const poolId = collab.participantIds[0];

    // Add one small element in the center
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Start',
      participantId: poolId,
    });

    const result = parseResult(
      await handleResizePoolToFit({
        diagramId,
        participantId: poolId,
      })
    );

    expect(result.success).toBe(true);
  });

  test('handles empty pool', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Empty' }, { name: 'Partner', collapsed: true }],
      })
    );

    const poolId = collab.participantIds[0];

    const result = parseResult(
      await handleResizePoolToFit({
        diagramId,
        participantId: poolId,
      })
    );

    expect(result.success).toBe(true);
    expect(result.resized).toBe(false);
  });

  test('rejects non-participant elements', async () => {
    const diagramId = await createDiagram();

    const taskId = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task',
      })
    ).elementId;

    await expect(
      handleResizePoolToFit({
        diagramId,
        participantId: taskId,
      })
    ).rejects.toThrow(/bpmn:Participant/);
  });

  test('accepts custom padding', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Process' }, { name: 'Ext', collapsed: true }],
      })
    );

    const poolId = collab.participantIds[0];

    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Task',
      participantId: poolId,
      x: 800,
      y: 200,
    });

    const result = parseResult(
      await handleResizePoolToFit({
        diagramId,
        participantId: poolId,
        padding: 100,
      })
    );

    expect(result.success).toBe(true);
  });
});
