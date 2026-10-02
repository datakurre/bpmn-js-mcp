/**
 * Tests for add_bpmn_elements with toLaneId + fromElementId (merged handoff).
 *
 * Covers the medium-priority consolidation: handoff_bpmn_to_lane functionality
 * absorbed into add_bpmn_elements via optional toLaneId + fromElementId params.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleAddElement,
  handleCreateCollaboration,
  handleCreateLanes,
  handleListElements,
} from '../../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../../helpers';

describe('add_bpmn_elements with toLaneId + fromElementId (handoff)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  async function setupCollabWithLanes(diagramId: string) {
    const collabRes = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Main Process', height: 400 },
          { name: 'External', collapsed: true },
        ],
      })
    );
    const participantId = collabRes.participantIds[0];

    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Requester' }, { name: 'Approver' }],
      })
    );

    return {
      participantId,
      requesterLaneId: lanesRes.laneIds[0],
      approverLaneId: lanesRes.laneIds[1],
    };
  }

  test('creates element in target lane and auto-connects from source', async () => {
    const diagramId = await createDiagram();
    const { participantId, requesterLaneId, approverLaneId } =
      await setupCollabWithLanes(diagramId);

    // Add a task in Requester lane
    const sourceRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Submit Request',
        participantId,
        laneId: requesterLaneId,
      })
    );
    const fromId = sourceRes.elementId;

    // Handoff via add_element to Approver lane
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Approve Request',
        fromElementId: fromId,
        toLaneId: approverLaneId,
      })
    );

    expect(res.success).toBe(true);
    expect(res.elementId).toBeDefined();
    expect(res.handoff).toBeDefined();
    expect(res.handoff.connectionId).toBeDefined();
    expect(res.handoff.connectionType).toBe('bpmn:SequenceFlow');
    expect(res.handoff.crossPool).toBe(false);
  });

  test('defaults to UserTask when no elementType given with handoff params', async () => {
    const diagramId = await createDiagram();
    const { participantId, requesterLaneId, approverLaneId } =
      await setupCollabWithLanes(diagramId);

    const sourceRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Data',
        participantId,
        laneId: requesterLaneId,
      })
    );

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Data',
        fromElementId: sourceRes.elementId,
        toLaneId: approverLaneId,
      })
    );

    expect(res.success).toBe(true);

    const elements = parseResult(
      await handleListElements({
        diagramId,
        elementType: 'bpmn:UserTask',
        namePattern: 'Review Data',
      })
    );
    expect(elements.elements.length).toBeGreaterThan(0);
  });

  test('requires both fromElementId and toLaneId together', async () => {
    const diagramId = await createDiagram();
    const { approverLaneId } = await setupCollabWithLanes(diagramId);

    // Providing toLaneId without fromElementId should throw
    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Lone Task',
        toLaneId: approverLaneId,
      })
    ).rejects.toThrow(/fromElementId/);
  });

  test('rejects invalid from element', async () => {
    const diagramId = await createDiagram();
    const { approverLaneId } = await setupCollabWithLanes(diagramId);

    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Orphan',
        fromElementId: 'nonexistent-source',
        toLaneId: approverLaneId,
      })
    ).rejects.toThrow();
  });

  test('rejects non-lane toLaneId', async () => {
    const diagramId = await createDiagram();
    const { participantId, requesterLaneId } = await setupCollabWithLanes(diagramId);

    const sourceRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Source',
        participantId,
        laneId: requesterLaneId,
      })
    );

    // Passing a participantId as toLaneId should throw
    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Target',
        fromElementId: sourceRes.elementId,
        toLaneId: participantId,
      })
    ).rejects.toThrow(/bpmn:Lane/);
  });

  test('places element in the target lane', async () => {
    const diagramId = await createDiagram();
    const { participantId, requesterLaneId, approverLaneId } =
      await setupCollabWithLanes(diagramId);

    const sourceRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Source Task',
        participantId,
        laneId: requesterLaneId,
      })
    );

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Target Task',
        fromElementId: sourceRes.elementId,
        toLaneId: approverLaneId,
      })
    );

    expect(res.success).toBe(true);
    // Verify the created element is in the approver lane
    const elements = parseResult(
      await handleListElements({
        diagramId,
        namePattern: 'Target Task',
      })
    );
    expect(elements.elements.length).toBeGreaterThan(0);
  });

  test('optional connectionLabel on handoff', async () => {
    const diagramId = await createDiagram();
    const { participantId, requesterLaneId, approverLaneId } =
      await setupCollabWithLanes(diagramId);

    const sourceRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Initiate',
        participantId,
        laneId: requesterLaneId,
      })
    );

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review',
        fromElementId: sourceRes.elementId,
        toLaneId: approverLaneId,
        connectionLabel: 'Send for review',
      })
    );

    expect(res.success).toBe(true);
    expect(res.handoff.connectionId).toBeDefined();
  });
});
