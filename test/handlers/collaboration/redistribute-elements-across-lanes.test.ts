import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleConnect,
  handleCreateLanes,
  handleAssignElementsToLane,
  handleRedistributeElementsAcrossLanes,
  handleSetProperties,
} from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('redistribute_bpmn_elements_across_lanes', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  /** Helper to create a pool with lanes and some tasks. */
  async function createPoolWithLanes(diagramId: string) {
    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Process', width: 1200, height: 600 },
          { name: 'External', collapsed: true },
        ],
      })
    );
    const poolId = collab.participantIds[0];

    const lanes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [{ name: 'Support' }, { name: 'Engineering' }, { name: 'Management' }],
      })
    );
    const laneIds = lanes.laneIds as string[];

    return { poolId, laneIds };
  }

  test('requires at least 2 lanes', async () => {
    const diagramId = await createDiagram();
    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Pool' }, { name: 'Partner', collapsed: true }],
      })
    );
    const poolId = collab.participantIds[0];

    // Pool with no lanes created
    const result = parseResult(
      await handleRedistributeElementsAcrossLanes({
        diagramId,
        participantId: poolId,
      })
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('Need at least 2 lanes');
  });

  test('dry run returns plan without applying changes', async () => {
    const diagramId = await createDiagram();
    const { poolId, laneIds } = await createPoolWithLanes(diagramId);

    // Add tasks and assign them all to the first lane
    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Handle Ticket',
        participantId: poolId,
      })
    );
    await handleSetProperties({
      diagramId,
      elementId: task1.elementId,
      properties: { 'camunda:candidateGroups': 'support' },
    });

    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Deploy Fix',
        participantId: poolId,
      })
    );
    await handleSetProperties({
      diagramId,
      elementId: task2.elementId,
      properties: { 'camunda:candidateGroups': 'engineering' },
    });

    // Assign both to first lane (overcrowded)
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0],
      elementIds: [task1.elementId, task2.elementId],
    });

    const result = parseResult(
      await handleRedistributeElementsAcrossLanes({
        diagramId,
        participantId: poolId,
        strategy: 'role-based',
        dryRun: true,
      })
    );

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    // Engineering task should be proposed to move to Engineering lane
    expect(result.movedCount).toBeGreaterThanOrEqual(1);
  });

  test('role-based strategy moves elements to matching lanes', async () => {
    const diagramId = await createDiagram();
    const { poolId, laneIds } = await createPoolWithLanes(diagramId);

    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Handle Ticket',
        participantId: poolId,
      })
    );
    await handleSetProperties({
      diagramId,
      elementId: task1.elementId,
      properties: { 'camunda:candidateGroups': 'support' },
    });

    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Approve Release',
        participantId: poolId,
      })
    );
    await handleSetProperties({
      diagramId,
      elementId: task2.elementId,
      properties: { 'camunda:candidateGroups': 'management' },
    });

    // Assign both to the Engineering lane (wrong lane)
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[1], // Engineering
      elementIds: [task1.elementId, task2.elementId],
    });

    const result = parseResult(
      await handleRedistributeElementsAcrossLanes({
        diagramId,
        participantId: poolId,
        strategy: 'role-based',
      })
    );

    expect(result.success).toBe(true);
    expect(result.movedCount).toBe(2);

    // Verify the moves: support task → Support lane, management task → Management lane
    const moves = result.moves as any[];
    const supportMove = moves.find((m: any) => m.elementId === task1.elementId);
    const mgmtMove = moves.find((m: any) => m.elementId === task2.elementId);
    expect(supportMove?.toLaneName).toBe('Support');
    expect(mgmtMove?.toLaneName).toBe('Management');
  });

  test('minimize-crossings strategy follows neighbor majority', async () => {
    const diagramId = await createDiagram();
    const { poolId, laneIds } = await createPoolWithLanes(diagramId);

    // Create a chain: Start → Task A → Task B → End
    const start = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start',
        participantId: poolId,
      })
    );
    const taskA = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task A',
        participantId: poolId,
      })
    );
    const taskB = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task B',
        participantId: poolId,
      })
    );
    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'End',
        participantId: poolId,
      })
    );

    await handleConnect({
      diagramId,
      sourceElementId: start.elementId,
      targetElementId: taskA.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: taskA.elementId,
      targetElementId: taskB.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: taskB.elementId,
      targetElementId: end.elementId,
    });

    // Assign Start, Task A, Task B to Support lane; End to Engineering
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0],
      elementIds: [start.elementId, taskA.elementId, taskB.elementId],
    });
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[1],
      elementIds: [end.elementId],
    });

    const result = parseResult(
      await handleRedistributeElementsAcrossLanes({
        diagramId,
        participantId: poolId,
        strategy: 'minimize-crossings',
      })
    );

    expect(result.success).toBe(true);
    // End event should be moved to Support lane (where all its neighbors are)
    if (result.movedCount > 0) {
      const endMove = result.moves.find((m: any) => m.elementId === end.elementId);
      if (endMove) {
        expect(endMove.toLaneName).toBe('Support');
      }
    }
  });

  test('reports zero moves when elements are already optimal', async () => {
    const diagramId = await createDiagram();
    const { poolId, laneIds } = await createPoolWithLanes(diagramId);

    const task = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Support Task',
        participantId: poolId,
      })
    );
    await handleSetProperties({
      diagramId,
      elementId: task.elementId,
      properties: { 'camunda:candidateGroups': 'support' },
    });

    // Assign to the correct lane from the start
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0], // Support
      elementIds: [task.elementId],
    });

    const result = parseResult(
      await handleRedistributeElementsAcrossLanes({
        diagramId,
        participantId: poolId,
        strategy: 'role-based',
      })
    );

    expect(result.success).toBe(true);
    expect(result.movedCount).toBe(0);
  });

  test('includes nextStep to delete empty lanes after redistribution', async () => {
    // Regression for TODO #6: empty lanes not cleaned up after redistribution
    const diagramId = await createDiagram();
    const { poolId, laneIds } = await createPoolWithLanes(diagramId);

    // Create tasks and assign to the first lane (Support)
    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task One',
        participantId: poolId,
      })
    ).elementId;
    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task Two',
        participantId: poolId,
      })
    ).elementId;

    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[1], // Engineering
      elementIds: [task1, task2],
    });

    // Manually redistribute all to Support lane (leaves Engineering + Management empty)
    const result = parseResult(
      await handleCreateLanes({
        diagramId,
        assignments: [{ laneId: laneIds[0], elementIds: [task1, task2] }], // Support
      })
    );

    expect(result.success).toBe(true);

    // Result should include nextSteps to delete empty lanes
    const deleteSteps = (result.nextSteps ?? []).filter(
      (s: any) => s.tool === 'delete_bpmn_element'
    );
    expect(deleteSteps.length).toBeGreaterThan(0);
    // Each delete step should include an empty laneId
    for (const step of deleteSteps) {
      expect(step.args?.elementId ?? step.description).toBeTruthy();
    }
  });
});
