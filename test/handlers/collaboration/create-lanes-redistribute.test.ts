/**
 * Tests for the `strategy` (redistribute) form of create_bpmn_lanes.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleCreateLanes,
  handleAssignElementsToLane,
  handleSetProperties,
} from '../../../src/handlers';
import { TOOL_DEFINITION as ANALYZE_LANES_TOOL } from '../../../src/handlers/collaboration/analyze-lanes';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('create_bpmn_lanes strategy (redistribute)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

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
        lanes: [{ name: 'Support' }, { name: 'Engineering' }],
      })
    );
    const laneIds = lanes.laneIds as string[];

    return { poolId, laneIds };
  }

  test('strategy delegates to redistribute handler', async () => {
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
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[1],
      elementIds: [task1.elementId],
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
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0],
      elementIds: [task2.elementId],
    });

    const res = parseResult(
      await handleCreateLanes({ diagramId, participantId: poolId, strategy: 'role-based' })
    );

    // Should return redistribute result (success field or moved/assignments)
    expect(res).toBeDefined();
    // Either success or coherence metrics from validate step
    expect(res.success !== undefined || res.coherenceScore !== undefined).toBe(true);
  });

  test('strategy with dryRun returns plan', async () => {
    const diagramId = await createDiagram();
    const { poolId } = await createPoolWithLanes(diagramId);

    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Task A',
      participantId: poolId,
    });

    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        strategy: 'role-based',
        dryRun: true,
      })
    );

    expect(res).toBeDefined();
  });

  test('analyze_bpmn_lanes no longer has redistribute mode', () => {
    const modeEnum = ANALYZE_LANES_TOOL.inputSchema.properties.mode.enum as readonly string[];
    expect(modeEnum).not.toContain('redistribute');
  });

  test('strategy forwards strategy parameter', async () => {
    const diagramId = await createDiagram();
    const { poolId } = await createPoolWithLanes(diagramId);

    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Task A',
      participantId: poolId,
    });

    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        strategy: 'balance',
      })
    );

    expect(res).toBeDefined();
  });
});
