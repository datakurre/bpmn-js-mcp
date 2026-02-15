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
  connectAll,
  clearDiagrams,
  getRegistry,
} from '../../helpers';

/**
 * Tests for lane-bound edge routing.
 *
 * Verifies that sequence flow waypoints for intra-lane connections
 * stay within their lane's Y-bounds after layout.
 */

describe('lane edge routing', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  /**
   * Helper: create a process with a pool and lanes, assign elements.
   * Returns lane IDs, element IDs, pool ID, and diagram ID.
   */
  async function createProcessWithLanes(
    laneCount: number,
    elementsPerLane: number
  ): Promise<{
    diagramId: string;
    poolId: string;
    laneIds: string[];
    elementsByLane: string[][];
  }> {
    const diagramId = await createDiagram(`Lane Edge Routing Test`);

    const elementsByLane: string[][] = [];
    const allElements: string[] = [];

    for (let lane = 0; lane < laneCount; lane++) {
      const laneElements: string[] = [];

      // First lane gets a start event, last lane gets an end event
      if (lane === 0) {
        const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
        laneElements.push(start);
        allElements.push(start);
      }

      for (let i = 0; i < elementsPerLane; i++) {
        const task = await addElement(diagramId, 'bpmn:UserTask', {
          name: `L${lane + 1} Task ${i + 1}`,
        });
        laneElements.push(task);
        allElements.push(task);
      }

      if (lane === laneCount - 1) {
        const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
        laneElements.push(end);
        allElements.push(end);
      }

      elementsByLane.push(laneElements);
    }

    // Connect all elements in sequence
    await connectAll(diagramId, ...allElements);

    // Wrap in collaboration
    const wrapResult = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'Test Process',
      })
    );
    const poolId = wrapResult.participantIds[0];

    // Create lanes
    const laneNames = Array.from({ length: laneCount }, (_, i) => ({
      name: `Lane ${i + 1}`,
    }));
    const laneResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: laneNames,
      })
    );
    const laneIds = laneResult.laneIds as string[];

    // Assign elements to lanes
    for (let i = 0; i < laneCount; i++) {
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[i],
        elementIds: elementsByLane[i],
      });
    }

    return { diagramId, poolId, laneIds, elementsByLane };
  }

  test('intra-lane flow waypoints stay within lane bounds', async () => {
    const { diagramId, laneIds, elementsByLane } = await createProcessWithLanes(2, 3);

    await handleLayoutDiagram({ diagramId });

    const registry = getRegistry(diagramId);

    // Check each lane's intra-lane connections
    for (let laneIdx = 0; laneIdx < laneIds.length; laneIdx++) {
      const lane = registry.get(laneIds[laneIdx]);
      if (!lane) continue;

      const laneTop = lane.y;
      const laneBottom = lane.y + lane.height;

      // Get elements in this lane
      const laneElementIds = new Set(elementsByLane[laneIdx]);

      // Find sequence flows between elements in this lane
      const allElements = registry.getAll();
      for (const el of allElements) {
        if (el.type !== 'bpmn:SequenceFlow') continue;
        if (!el.source || !el.target || !el.waypoints) continue;

        // Only check intra-lane flows
        if (!laneElementIds.has(el.source.id) || !laneElementIds.has(el.target.id)) continue;

        // All waypoints should be within lane bounds (with tolerance)
        const tolerance = 6; // LANE_CLAMP_MARGIN + 1px tolerance
        for (const wp of el.waypoints) {
          expect(wp.y).toBeGreaterThanOrEqual(
            laneTop - tolerance,
            `Waypoint Y=${wp.y} is above lane top=${laneTop} for flow ${el.id}`
          );
          expect(wp.y).toBeLessThanOrEqual(
            laneBottom + tolerance,
            `Waypoint Y=${wp.y} is below lane bottom=${laneBottom} for flow ${el.id}`
          );
        }
      }
    }
  });

  test('cross-lane flows are not clamped', async () => {
    const { diagramId, laneIds, elementsByLane } = await createProcessWithLanes(2, 2);

    await handleLayoutDiagram({ diagramId });

    const registry = getRegistry(diagramId);
    const lane1Elements = new Set(elementsByLane[0]);
    const lane2Elements = new Set(elementsByLane[1]);

    // Find cross-lane flows (source in lane 1, target in lane 2 or vice versa)
    const allElements = registry.getAll();
    let crossLaneFlowCount = 0;

    for (const el of allElements) {
      if (el.type !== 'bpmn:SequenceFlow') continue;
      if (!el.source || !el.target || !el.waypoints) continue;

      const srcInLane1 = lane1Elements.has(el.source.id);
      const srcInLane2 = lane2Elements.has(el.source.id);
      const tgtInLane1 = lane1Elements.has(el.target.id);
      const tgtInLane2 = lane2Elements.has(el.target.id);

      if ((srcInLane1 && tgtInLane2) || (srcInLane2 && tgtInLane1)) {
        crossLaneFlowCount++;
        // Cross-lane flows should have waypoints that span both lanes
        // (they should NOT be clamped to a single lane)
        const lane1 = registry.get(laneIds[0]);
        const lane2 = registry.get(laneIds[1]);
        if (lane1 && lane2) {
          const ys = el.waypoints.map((wp: { y: number }) => wp.y);
          const minWpY = Math.min(...ys);
          const maxWpY = Math.max(...ys);
          // The flow should span some vertical distance (crossing lanes)
          expect(maxWpY - minWpY).toBeGreaterThan(0);
        }
      }
    }

    // There should be at least one cross-lane flow
    expect(crossLaneFlowCount).toBeGreaterThan(0);
  });

  test('no-op for diagrams without lanes', async () => {
    const diagramId = await createDiagram('No Lanes');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connectAll(diagramId, start, task, end);

    // Should not throw and layout should succeed
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
  });
});
