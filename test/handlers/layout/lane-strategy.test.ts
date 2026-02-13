/**
 * Tests for laneStrategy parameter in layout_bpmn_diagram.
 *
 * Covers:
 * - laneStrategy: 'preserve' keeps original lane order
 * - laneStrategy: 'optimize' reorders lanes to minimise cross-lane flows
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleCreateLanes,
  handleAssignElementsToLane,
  handleWrapProcessInCollaboration,
} from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  connect,
  clearDiagrams,
  getRegistry,
} from '../../helpers';

describe('laneStrategy option', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  /**
   * Build a 3-lane process where the flow goes Lane1 → Lane3 → Lane2 → End.
   * The initial lane order is [Lane1, Lane2, Lane3].
   *
   * With 'preserve', lanes stay in order: 1, 2, 3
   * With 'optimize', lanes should reorder to minimise jumps: 1, 3, 2
   */
  async function createCrossLaneProcess(): Promise<{
    diagramId: string;
    poolId: string;
    laneIds: string[];
    taskIds: string[];
  }> {
    const diagramId = await createDiagram('Lane Strategy Test');

    // Create tasks
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task C' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, t3);
    await connect(diagramId, t3, end);

    // Wrap in collaboration
    const wrapResult = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'Process',
      })
    );
    const poolId = wrapResult.participantIds[0];

    // Create 3 lanes
    const laneResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [{ name: 'Lane 1' }, { name: 'Lane 2' }, { name: 'Lane 3' }],
      })
    );
    const laneIds = laneResult.laneIds as string[];

    // Assign: Start + Task A → Lane 1, Task B → Lane 3, Task C + End → Lane 2
    // This creates flow: Lane1 → Lane3 → Lane2 (skip-one jump)
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0], // Lane 1
      elementIds: [start, t1],
    });
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[2], // Lane 3
      elementIds: [t2],
    });
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[1], // Lane 2
      elementIds: [t3, end],
    });

    return { diagramId, poolId, laneIds, taskIds: [start, t1, t2, t3, end] };
  }

  test('laneStrategy "preserve" keeps original lane order', async () => {
    const { diagramId, laneIds } = await createCrossLaneProcess();

    const res = parseResult(await handleLayoutDiagram({ diagramId, laneStrategy: 'preserve' }));
    expect(res.success).toBe(true);

    const registry = getRegistry(diagramId);
    const lane1 = registry.get(laneIds[0]);
    const lane2 = registry.get(laneIds[1]);
    const lane3 = registry.get(laneIds[2]);

    // With 'preserve', Lane 1 should be above Lane 2, which should be above Lane 3
    expect(lane1.y).toBeLessThan(lane2.y);
    expect(lane2.y).toBeLessThan(lane3.y);
  });

  test('laneStrategy "optimize" reorders lanes to minimise crossings', async () => {
    const { diagramId, laneIds } = await createCrossLaneProcess();

    const res = parseResult(await handleLayoutDiagram({ diagramId, laneStrategy: 'optimize' }));
    expect(res.success).toBe(true);

    // The optimiser should reorder lanes so that the flow path
    // doesn't skip lanes. With flow Lane1→Lane3→Lane2, the optimal
    // order is Lane1, Lane3, Lane2 (all adjacent hops = cost 2)
    // vs the original Lane1, Lane2, Lane3 (hops: 1→3=2, 3→2=1 = cost 3)
    const registry = getRegistry(diagramId);
    const lane1 = registry.get(laneIds[0]);
    const lane2 = registry.get(laneIds[1]);
    const lane3 = registry.get(laneIds[2]);

    // Lane 3 should now be between Lane 1 and Lane 2
    // (Lane1.y < Lane3.y < Lane2.y)
    expect(lane1.y).toBeLessThan(lane3.y);
    expect(lane3.y).toBeLessThan(lane2.y);
  });

  test('laneStrategy "optimize" with no cross-lane flows preserves order', async () => {
    const diagramId = await createDiagram('All Same Lane');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, t1);
    await connect(diagramId, t1, end);

    const wrapResult = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'Process',
      })
    );
    const poolId = wrapResult.participantIds[0];

    const laneResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );
    const laneIds = laneResult.laneIds as string[];

    // All elements in the same lane
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0],
      elementIds: [start, t1, end],
    });

    const res = parseResult(await handleLayoutDiagram({ diagramId, laneStrategy: 'optimize' }));
    expect(res.success).toBe(true);

    // No cross-lane flows, so order should stay the same
    const registry = getRegistry(diagramId);
    const laneA = registry.get(laneIds[0]);
    const laneB = registry.get(laneIds[1]);
    expect(laneA.y).toBeLessThan(laneB.y);
  });

  test('default laneStrategy preserves lane order', async () => {
    const { diagramId, laneIds } = await createCrossLaneProcess();

    // No laneStrategy specified — should default to 'preserve'
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    const registry = getRegistry(diagramId);
    const lane1 = registry.get(laneIds[0]);
    const lane2 = registry.get(laneIds[1]);
    const lane3 = registry.get(laneIds[2]);

    // Original order preserved: Lane1 < Lane2 < Lane3
    expect(lane1.y).toBeLessThan(lane2.y);
    expect(lane2.y).toBeLessThan(lane3.y);
  });
});
