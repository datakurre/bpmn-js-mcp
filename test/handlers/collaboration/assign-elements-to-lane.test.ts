import { describe, test, expect, beforeEach } from 'vitest';
import { handleAssignElementsToLane, handleCreateLanes } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('assign_bpmn_elements_to_lane', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  async function createPoolWithLanes(diagramId: string) {
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 300,
      y: 300,
    });
    const lanesResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );
    return { participant, laneIds: lanesResult.laneIds as string[] };
  }

  test('assigns elements to a lane', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });

    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [task],
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedCount).toBe(1);
    expect(res.assignedElementIds).toContain(task);
  });

  test('assigns multiple elements', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 2' });

    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[1],
        elementIds: [t1, t2],
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedCount).toBe(2);
  });

  test('skips non-existent elements', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [task, 'nonexistent_element'],
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedCount).toBe(1);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0].reason).toContain('not found');
  });

  test('rejects non-lane target', async () => {
    const diagramId = await createDiagram();
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });

    await expect(
      handleAssignElementsToLane({
        diagramId,
        laneId: task,
        elementIds: [task2],
      })
    ).rejects.toThrow(/bpmn:Lane/);
  });

  test('supports reposition=false to keep positions', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [task],
        reposition: false,
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedCount).toBe(1);
  });
});
