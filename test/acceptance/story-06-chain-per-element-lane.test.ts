/**
 * Acceptance test: add_bpmn_elements with per-element laneId overrides.
 *
 * Verifies that when `add_bpmn_elements` is called with a per-element
 * `laneId`, each element ends up in the correct lane — even when different
 * elements within the same chain are assigned to different lanes.
 *
 * This is a regression guard for the per-element laneId feature that was
 * already implemented in add-element-chain.ts (line 188: `laneId: el.laneId || args.laneId`).
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateParticipant,
  handleCreateLanes,
  handleAddElementChain,
} from '../../src/handlers';
import { createDiagram, clearDiagrams, parseResult, getRegistry } from '../helpers';

describe('add_bpmn_elements — per-element laneId override', () => {
  beforeEach(() => clearDiagrams());

  test('elements are placed in their own lane when per-element laneId is set', async () => {
    const diagramId = await createDiagram();

    // Create a pool with 3 lanes
    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Process Pool', height: 450 })
    );
    const participantId = poolRes.participantId as string;

    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Customer' }, { name: 'Agent' }, { name: 'System' }],
      })
    );
    // handleCreateLanes returns { laneIds: string[], laneNames: string[] }
    const laneIds: string[] = lanesRes.laneIds;
    const laneNames: string[] = lanesRes.laneNames;
    const laneMap = Object.fromEntries(laneNames.map((n: string, i: number) => [n, laneIds[i]]));
    const customerLane = { id: laneMap['Customer'], name: 'Customer' };
    const agentLane = { id: laneMap['Agent'], name: 'Agent' };
    const systemLane = { id: laneMap['System'], name: 'System' };

    // Build a chain where each element explicitly targets a different lane
    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId,
        participantId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Request Received', laneId: customerLane.id },
          { elementType: 'bpmn:UserTask', name: 'Fill Form', laneId: customerLane.id },
          { elementType: 'bpmn:UserTask', name: 'Review Request', laneId: agentLane.id },
          { elementType: 'bpmn:ServiceTask', name: 'Process in System', laneId: systemLane.id },
          { elementType: 'bpmn:EndEvent', name: 'Done', laneId: agentLane.id },
        ],
      })
    );

    const createdIds: string[] =
      chainRes.elementIds ?? chainRes.elements?.map((e: any) => e.id) ?? [];
    expect(createdIds).toHaveLength(5);

    // Check lane membership via the element registry — in bpmn-js an element's
    // immediate parent is its lane (if it belongs to one).
    const registry = getRegistry(diagramId);
    function laneOf(elementId: string): string | undefined {
      const el = registry.get(elementId);
      if (!el) return undefined;
      if (el.parent?.type === 'bpmn:Lane') return el.parent.id;
      // Also check via the lane's flowNodeRef list
      const lanes = registry.filter((e: any) => e.type === 'bpmn:Lane');
      for (const lane of lanes) {
        const refs: any[] = lane.businessObject?.flowNodeRef ?? [];
        if (refs.some((r: any) => r.id === elementId)) return lane.id;
      }
      return undefined;
    }

    const [startId, fillId, reviewId, processId, endId] = createdIds;

    expect(laneOf(startId), 'Start event should be in Customer lane').toBe(customerLane.id);
    expect(laneOf(fillId), 'Fill Form task should be in Customer lane').toBe(customerLane.id);
    expect(laneOf(reviewId), 'Review Request task should be in Agent lane').toBe(agentLane.id);
    expect(laneOf(processId), 'Process in System task should be in System lane').toBe(
      systemLane.id
    );
    expect(laneOf(endId), 'Done event should be in Agent lane').toBe(agentLane.id);
  });

  test('top-level laneId is used as default when no per-element override', async () => {
    const diagramId = await createDiagram();

    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Simple Pool', height: 300 })
    );
    const participantId = poolRes.participantId as string;

    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );
    const laneIds: string[] = lanesRes.laneIds;
    const laneNames: string[] = lanesRes.laneNames;
    const laneMap = Object.fromEntries(laneNames.map((n: string, i: number) => [n, laneIds[i]]));
    const laneA = { id: laneMap['Lane A'], name: 'Lane A' };

    // Chain with a top-level laneId and no per-element overrides
    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId,
        participantId,
        laneId: laneA.id,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Task' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
      })
    );

    const createdIds: string[] =
      chainRes.elementIds ?? chainRes.elements?.map((e: any) => e.id) ?? [];
    expect(createdIds).toHaveLength(3);

    const registry = getRegistry(diagramId);
    for (const id of createdIds) {
      const el = registry.get(id);
      let foundLaneId: string | undefined;
      if (el?.parent?.type === 'bpmn:Lane') {
        foundLaneId = el.parent.id;
      } else {
        const lanes = registry.filter((e: any) => e.type === 'bpmn:Lane');
        for (const lane of lanes) {
          const refs: any[] = lane.businessObject?.flowNodeRef ?? [];
          if (refs.some((r: any) => r.id === id)) {
            foundLaneId = lane.id;
            break;
          }
        }
      }
      expect(foundLaneId, `Element ${id} should be in Lane A`).toBe(laneA.id);
    }
  });
});
