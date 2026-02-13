/**
 * Tests for cross-pool connection auto-detection and MessageFlow validation.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleConnect, handleCreateCollaboration, handleAddElement } from '../../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../../helpers';

describe('connect_bpmn_elements — cross-pool handling', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('auto-corrects SequenceFlow to MessageFlow for cross-pool connections', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Pool A' }, { name: 'Pool B' }],
      })
    );

    const poolA = collab.participantIds[0];
    const poolB = collab.participantIds[1];

    // Add elements in different pools
    const taskA = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Task A',
        participantId: poolA,
      })
    );
    const taskB = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Task B',
        participantId: poolB,
      })
    );

    // Connect without specifying type - should auto-detect MessageFlow
    const conn = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: taskA.elementId,
        targetElementId: taskB.elementId,
      })
    );

    expect(conn.success).toBe(true);
    expect(conn.connectionType).toBe('bpmn:MessageFlow');
    expect(conn.hint).toContain('auto-corrected');
    expect(conn.hint).toContain('MessageFlow');
  });

  test('rejects MessageFlow for same-pool connections', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Pool A' }, { name: 'Pool B' }],
      })
    );

    const poolA = collab.participantIds[0];

    // Add two elements in the same pool
    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task 1',
        participantId: poolA,
      })
    );
    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task 2',
        participantId: poolA,
      })
    );

    // Explicitly requesting MessageFlow within same pool should fail
    await expect(
      handleConnect({
        diagramId,
        sourceElementId: task1.elementId,
        targetElementId: task2.elementId,
        connectionType: 'bpmn:MessageFlow',
      })
    ).rejects.toThrow(/different participants/);
  });
});
