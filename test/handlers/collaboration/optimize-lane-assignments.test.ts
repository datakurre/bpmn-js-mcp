import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleConnect,
  handleCreateLanes,
  handleAssignElementsToLane,
  handleOptimizeLaneAssignments,
} from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('optimize_bpmn_lane_assignments', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  /** Helper to create a pool with 2 lanes and some elements with cross-lane flows. */
  async function createPoolWithCrossLaneFlows(diagramId: string) {
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
        lanes: [{ name: 'Support' }, { name: 'Engineering' }],
      })
    );
    const laneIds = lanes.laneIds as string[];

    // Create a chain: Start → T1 → T2 → T3 → End
    const start = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent', participantId: poolId })
    );
    const t1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task A',
        participantId: poolId,
      })
    );
    const t2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task B',
        participantId: poolId,
      })
    );
    const t3 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task C',
        participantId: poolId,
      })
    );
    const end = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:EndEvent', participantId: poolId })
    );

    await handleConnect({
      diagramId,
      sourceElementId: start.elementId,
      targetElementId: t1.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: t1.elementId,
      targetElementId: t2.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: t2.elementId,
      targetElementId: t3.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: t3.elementId,
      targetElementId: end.elementId,
    });

    // Assign elements in a zigzag pattern (Support → Engineering → Support → Engineering)
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0], // Support
      elementIds: [start.elementId, t1.elementId, t3.elementId, end.elementId],
    });
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[1], // Engineering
      elementIds: [t2.elementId],
    });

    return {
      poolId,
      laneIds,
      elementIds: [start.elementId, t1.elementId, t2.elementId, t3.elementId, end.elementId],
    };
  }

  test('returns success without changes when lanes are already well-organized', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Process', width: 1200, height: 400 },
          { name: 'External', collapsed: true },
        ],
      })
    );
    const poolId = collab.participantIds[0];

    const lanes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [{ name: 'Support' }, { name: 'Engineering' }],
      })
    );
    const laneIds = lanes.laneIds as string[];

    // Create chain: all in one lane (100% coherence)
    const start = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent', participantId: poolId })
    );
    const t1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task A',
        participantId: poolId,
      })
    );
    const end = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:EndEvent', participantId: poolId })
    );
    await handleConnect({
      diagramId,
      sourceElementId: start.elementId,
      targetElementId: t1.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: t1.elementId,
      targetElementId: end.elementId,
    });

    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0],
      elementIds: [start.elementId, t1.elementId, end.elementId],
    });

    const result = parseResult(await handleOptimizeLaneAssignments({ diagramId }));
    expect(result.success).toBe(true);
    expect(result.optimized).toBe(false);
    expect(result.coherenceScore).toBeGreaterThanOrEqual(70);
  });

  test('fails when no participant with lanes exists', async () => {
    const diagramId = await createDiagram();
    const result = parseResult(await handleOptimizeLaneAssignments({ diagramId }));
    expect(result.success).toBe(false);
    expect(result.message).toContain('No participant with at least 2 lanes');
  });

  test('dry run returns plan without applying changes', async () => {
    const diagramId = await createDiagram();
    await createPoolWithCrossLaneFlows(diagramId);

    const result = parseResult(await handleOptimizeLaneAssignments({ diagramId, dryRun: true }));
    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    // Should have a before measurement
    expect(result.before).toBeDefined();
    expect(result.before.coherenceScore).toBeDefined();
  });

  test('optimizes cross-lane flows and reports improvement', async () => {
    const diagramId = await createDiagram();
    const { poolId } = await createPoolWithCrossLaneFlows(diagramId);

    const result = parseResult(
      await handleOptimizeLaneAssignments({ diagramId, participantId: poolId })
    );
    expect(result.success).toBe(true);
    expect(result.before).toBeDefined();
    // After optimization, coherence should be at least as good as before
    if (result.optimized && result.after) {
      expect(result.after.coherenceScore).toBeGreaterThanOrEqual(result.before.coherenceScore);
    }
  });

  test('supports explicit participant ID', async () => {
    const diagramId = await createDiagram();
    const { poolId } = await createPoolWithCrossLaneFlows(diagramId);

    const result = parseResult(
      await handleOptimizeLaneAssignments({ diagramId, participantId: poolId })
    );
    expect(result.success).toBe(true);
    expect(result.participantId).toBe(poolId);
  });
});
