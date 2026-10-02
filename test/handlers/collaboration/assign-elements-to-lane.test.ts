import { describe, test, expect, beforeEach } from 'vitest';
import { handleAssignElementsToLane, handleCreateLanes } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

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

  test('skips boundary events and suggests assigning host instead', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task', x: 300, y: 200 });
    const be = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timer',
      hostElementId: task,
    });

    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [be],
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedCount).toBe(0);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0].elementId).toBe(be);
    expect(res.skipped[0].reason).toContain('host task');
  });

  test('auto-assigns boundary events when host task is assigned', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task', x: 300, y: 200 });
    const be = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timer',
      hostElementId: task,
    });

    // Assign the host task — boundary event should follow automatically
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

    // Check that the boundary event's BO was added to the lane's flowNodeRef
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;
    const laneEl = reg.get(laneIds[0]);
    const laneRefs = laneEl.businessObject?.flowNodeRef || [];
    const beEl = reg.get(be);
    expect(laneRefs).toContain(beEl.businessObject);
  });

  describe('create_bpmn_lanes assignments form', () => {
    test('assigns to multiple lanes in one call without participantId', async () => {
      const diagramId = await createDiagram();
      const { laneIds } = await createPoolWithLanes(diagramId);
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
      const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 2' });

      const result = await handleCreateLanes({
        diagramId,
        assignments: [
          { laneId: laneIds[0], elementIds: [t1] },
          { laneId: laneIds[1], elementIds: [t2] },
        ],
      });
      const res = parseResult(result);

      expect(res.success).toBe(true);
      expect(res.assignments).toHaveLength(2);
      expect(res.assignments[0].assignedElementIds).toEqual([t1]);
      expect(res.assignments[1].assignedElementIds).toEqual([t2]);
      // Goes through the shared lint/viewer feedback path (adds the diagram image)
      expect(result.content.some((c: any) => c.type === 'image')).toBe(true);
    });

    test('rejects a non-lane laneId before applying any assignment', async () => {
      const diagramId = await createDiagram();
      const { participant, laneIds } = await createPoolWithLanes(diagramId);
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
      const membership = () =>
        laneIds.map((id) => (reg.get(id).businessObject.flowNodeRef || []).map((r: any) => r.id));
      const before = membership();

      await expect(
        handleCreateLanes({
          diagramId,
          assignments: [
            { laneId: laneIds[1], elementIds: [t1] },
            { laneId: participant, elementIds: [t1] },
          ],
        })
      ).rejects.toThrow();

      // Membership is unchanged by the rejected call
      expect(membership()).toEqual(before);
    });

    test('reports skipped elements', async () => {
      const diagramId = await createDiagram();
      const { laneIds } = await createPoolWithLanes(diagramId);
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });

      const res = parseResult(
        await handleCreateLanes({
          diagramId,
          assignments: [{ laneId: laneIds[0], elementIds: [t1, 'Missing_1'] }],
        })
      );

      expect(res.assignments[0].assignedElementIds).toEqual([t1]);
      expect(res.assignments[0].skipped).toEqual([
        { elementId: 'Missing_1', reason: 'Element not found' },
      ]);
    });

    test.each([
      ['lanes + assignments', { lanes: [{ name: 'A' }, { name: 'B' }] }],
      ['strategy + assignments', { strategy: 'balance' as const }],
      ['mergeFrom + assignments', { mergeFrom: 'Participant_1' }],
    ])('rejects mixed forms: %s', async (_label, extra) => {
      const diagramId = await createDiagram();
      const { laneIds } = await createPoolWithLanes(diagramId);
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });

      await expect(
        handleCreateLanes({
          diagramId,
          assignments: [{ laneId: laneIds[0], elementIds: [t1] }],
          ...extra,
        })
      ).rejects.toThrow(/mutually exclusive/);
    });
  });
});
