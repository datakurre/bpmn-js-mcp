import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateLanes } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('create_bpmn_lanes', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates lanes in a participant', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Main Pool',
      x: 300,
      y: 200,
    });

    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Requesters' }, { name: 'Approvers' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.laneCount).toBe(2);
    expect(res.laneIds).toHaveLength(2);
    expect(res.laneIds[0]).toContain('Lane');
    expect(res.laneIds[1]).toContain('Lane');
  });

  test('creates lanes with explicit heights', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 300,
      y: 200,
    });

    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [
          { name: 'Small Lane', height: 100 },
          { name: 'Large Lane', height: 200 },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.laneCount).toBe(2);
  });

  test('rejects fewer than 2 lanes', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 300,
      y: 200,
    });

    await expect(
      handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Solo Lane' }],
      })
    ).rejects.toThrow(/at least 2/);
  });

  test('rejects non-participant target', async () => {
    const diagramId = await createDiagram();
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    await expect(
      handleCreateLanes({
        diagramId,
        participantId: task,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    ).rejects.toThrow(/bpmn:Participant/);
  });

  test('creates three lanes', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Organization',
      x: 300,
      y: 200,
    });

    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Requesters' }, { name: 'Managers' }, { name: 'Finance' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.laneCount).toBe(3);
    expect(res.laneIds).toHaveLength(3);
  });

  test('rejects duplicate lane creation on same participant', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 300,
      y: 200,
    });

    // First call should succeed
    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );
    expect(res.success).toBe(true);
    expect(res.laneCount).toBe(2);

    // Second call on the same participant should reject
    await expect(
      handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Lane C' }, { name: 'Lane D' }],
      })
    ).rejects.toThrow(/already has/);
  });

  // ── mergeFrom (merged from convert_bpmn_collaboration_to_lanes) ───────────

  test('mergeFrom converts a collaboration to a single pool with lanes', async () => {
    const { handleCreateParticipant, handleAddElement } = await import('../../../src/handlers');
    const diagramId = await createDiagram();

    // Create a two-pool collaboration
    const poolRes = parseResult(
      await handleCreateParticipant({
        diagramId,
        participants: [{ name: 'Pool A' }, { name: 'Pool B' }],
      })
    );
    const [poolA, poolB] = poolRes.participantIds as string[];

    // Add a start event to Pool A
    await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent', participantId: poolA });
    // Add a task to Pool B
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:Task',
      name: 'B Task',
      participantId: poolB,
    });

    // mergeFrom: pass the main participant ID to keep
    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolA,
        mergeFrom: poolA,
        layout: false,
      })
    );

    expect(res.success).toBe(true);
    // After merge there should be only one pool
    const { handleListElements } = await import('../../../src/handlers');
    const els = parseResult(
      await handleListElements({ diagramId, elementType: 'bpmn:Participant' })
    );
    expect(els.count).toBe(1);
  });
});
