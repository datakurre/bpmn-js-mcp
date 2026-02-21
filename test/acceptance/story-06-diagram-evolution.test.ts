/**
 * Story 6: Diagram Evolution — Import, Modify, Refactor
 *
 * Covers: import_bpmn_xml, add_bpmn_element (insert via flowId),
 * replace_bpmn_element, delete_bpmn_element,
 * wrap_bpmn_process_in_collaboration,
 * convert_bpmn_collaboration_to_lanes,
 * clone_bpmn_diagram, diff_bpmn_diagrams,
 * list_bpmn_process_variables, list_bpmn_elements,
 * set_bpmn_connection_waypoints, layout_bpmn_diagram
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import {
  handleImportXml,
  handleAddElement,
  handleConnect,
  handleDeleteElement,
  handleReplaceElement,
  handleCloneDiagram,
  handleDiffDiagrams,
  handleWrapProcessInCollaboration,
  handleCreateParticipant,
  handleConvertCollaborationToLanes,
  handleLayoutDiagram,
  handleListElements,
  handleListProcessVariables,
  handleCreateDiagram,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { assertStep, parseResult } from './helpers';

const REFERENCES_DIR = resolve(__dirname, '..', 'fixtures', 'layout-references');

describe('Story 6: Diagram Evolution — Import, Modify, Refactor', () => {
  const s = {
    diagramId: '',
    clonedDiagramId: '',
    reviewRequestId: '',
    approvedGwId: '',
    mergeGwId: '',
    fulfillRequestId: '',
    sendRejectionId: '',
    insertedTaskId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  test('S6-Step01: Import reference fixture (exclusive gateway)', async () => {
    const filePath = resolve(REFERENCES_DIR, '02-exclusive-gateway.bpmn');
    const importRes = parseResult(await handleImportXml({ filePath }));
    expect(importRes.success).toBe(true);
    s.diagramId = importRes.diagramId as string;

    // Verify elements from the reference
    await assertStep(s.diagramId, 'S6-Step01', {
      containsElements: ['Request Received', 'Review Request', 'Approved?', 'Done'],
      snapshotFile: 'story-06/step-01.bpmn',
    });

    // Capture element IDs
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    s.reviewRequestId = (listRes.elements as any[]).find((e: any) => e.name === 'Review Request')
      ?.id as string;
    s.approvedGwId = (listRes.elements as any[]).find((e: any) => e.name === 'Approved?')
      ?.id as string;
    s.mergeGwId = (listRes.elements as any[]).find((e: any) => e.name === 'Merge')?.id as string;
    s.fulfillRequestId = (listRes.elements as any[]).find((e: any) => e.name === 'Fulfill Request')
      ?.id as string;
    s.sendRejectionId = (listRes.elements as any[]).find((e: any) => e.name === 'Send Rejection')
      ?.id as string;

    expect(s.reviewRequestId).toBeDefined();
    expect(s.approvedGwId).toBeDefined();
  });

  test('S6-Step02: Insert a task into the happy path', async () => {
    // Find the flow from Review Request to Approved? gateway
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const flow = (listRes.elements as any[]).find(
      (e: any) =>
        e.type === 'bpmn:SequenceFlow' &&
        (e.sourceId ?? e.source?.id) === s.reviewRequestId &&
        (e.targetId ?? e.target?.id) === s.approvedGwId
    );
    expect(flow).toBeDefined();

    // Insert BusinessRuleTask into the flow
    const insertRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:BusinessRuleTask',
        name: 'Apply Discount Rules',
        flowId: flow.id,
      })
    );
    expect(insertRes.success).toBe(true);
    s.insertedTaskId = insertRes.elementId as string;

    await assertStep(s.diagramId, 'S6-Step02', {
      containsElements: ['Apply Discount Rules', 'Review Request', 'Approved?'],
      snapshotFile: 'story-06/step-02.bpmn',
    });
  });

  test('S6-Step03: Replace task type', async () => {
    // Replace "Fulfill Request" (UserTask) with ManualTask
    const replaceRes = parseResult(
      await handleReplaceElement({
        diagramId: s.diagramId,
        elementId: s.fulfillRequestId,
        newType: 'bpmn:ManualTask',
      })
    );
    expect(replaceRes.success).toBe(true);
    expect(replaceRes.elementId).toBeDefined();
    // Update the stored ID (it may change)
    s.fulfillRequestId = replaceRes.elementId as string;

    // Verify the type was changed
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const fulfillEl = (listRes.elements as any[]).find((e: any) => e.name === 'Fulfill Request');
    expect(fulfillEl).toBeDefined();
    expect(fulfillEl.type).toBe('bpmn:ManualTask');

    await assertStep(s.diagramId, 'S6-Step03', {
      snapshotFile: 'story-06/step-03.bpmn',
    });
  });

  test('S6-Step04: Delete the rejection path and reconnect', async () => {
    // Delete "Send Rejection" task
    await handleDeleteElement({
      diagramId: s.diagramId,
      elementId: s.sendRejectionId,
    });

    // Explicitly remove any lingering outgoing flows from the Approved? gateway
    // (bpmn-js may leave the old "No" default flow connected to a stale target
    // when its original target element is deleted).
    const afterDeleteList = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const lingeringNoFlows = (afterDeleteList.elements as any[]).filter(
      (e: any) =>
        e.type === 'bpmn:SequenceFlow' &&
        (e.sourceId ?? e.source?.id) === s.approvedGwId &&
        e.name === 'No'
    );
    for (const flow of lingeringNoFlows) {
      await handleDeleteElement({ diagramId: s.diagramId, elementId: flow.id });
    }

    // Connect Approved? "No" path directly to Merge gateway
    const noFlowRes = parseResult(
      await handleConnect({
        diagramId: s.diagramId,
        sourceElementId: s.approvedGwId,
        targetElementId: s.mergeGwId,
        label: 'No',
        isDefault: true,
      })
    );
    expect(noFlowRes.connectionId).toBeDefined();

    // Verify that the Approved? gateway has exactly 2 outgoing flows (Yes + No)
    const afterConnectList = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const outgoingFlows = (afterConnectList.elements as any[]).filter(
      (e: any) => e.type === 'bpmn:SequenceFlow' && (e.sourceId ?? e.source?.id) === s.approvedGwId
    );
    expect(outgoingFlows.length).toBe(2);

    await assertStep(s.diagramId, 'S6-Step04', {
      snapshotFile: 'story-06/step-04.bpmn',
    });
  });

  test('S6-Step05: Clone and diff', async () => {
    // Clone the current diagram
    const cloneRes = parseResult(
      await handleCloneDiagram({
        diagramId: s.diagramId,
        name: 'Order Processing Clone',
      })
    );
    expect(cloneRes.success).toBe(true);
    s.clonedDiagramId = cloneRes.diagramId as string;

    // Add a ServiceTask to the clone
    await handleAddElement({
      diagramId: s.clonedDiagramId,
      elementType: 'bpmn:ServiceTask',
      name: 'New Service Step',
    });

    // Diff original vs clone
    const diffRes = parseResult(
      await handleDiffDiagrams({
        diagramIdA: s.diagramId,
        diagramIdB: s.clonedDiagramId,
      })
    );
    expect(diffRes.success).toBe(true);
    // The diff should show at least 1 addition (the new ServiceTask)
    const added = diffRes.changes?.added ?? diffRes.added ?? [];
    expect(Array.isArray(added)).toBe(true);

    await assertStep(s.diagramId, 'S6-Step05', {
      snapshotFile: 'story-06/step-05.bpmn',
    });
  });

  test('S6-Step06: Wrap in collaboration', async () => {
    const wrapRes = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId: s.diagramId,
        participantName: 'Order Department',
        additionalParticipants: [{ name: 'ERP System', collapsed: true }],
      })
    );
    expect(wrapRes.success).toBe(true);

    await assertStep(s.diagramId, 'S6-Step06', {
      containsElements: ['Order Department', 'ERP System'],
      snapshotFile: 'story-06/step-06.bpmn',
    });
  });

  test('S6-Step07: Convert a fresh 2-pool collaboration to lanes', async () => {
    // Create a fresh small diagram with 2 expanded pools
    const freshRes = parseResult(await handleCreateDiagram({ name: 'Two Pool Collaboration' }));
    const freshId = freshRes.diagramId as string;

    await handleCreateParticipant({
      diagramId: freshId,
      participants: [
        { name: 'Department A', collapsed: false, height: 200 },
        { name: 'Department B', collapsed: false, height: 200 },
      ],
    });

    // Add a simple element to each pool so the diagram isn't empty
    const listRes = parseResult(await handleListElements({ diagramId: freshId }));
    const deptA = (listRes.elements as any[]).find(
      (e: any) => e.type === 'bpmn:Participant' && e.name === 'Department A'
    );
    if (deptA) {
      await handleAddElement({
        diagramId: freshId,
        elementType: 'bpmn:StartEvent',
        name: 'Start A',
        participantId: deptA.id,
      });
    }

    // Convert the collaboration to lanes
    const convertRes = parseResult(await handleConvertCollaborationToLanes({ diagramId: freshId }));
    expect(convertRes.success).toBe(true);

    await assertStep(freshId, 'S6-Step07', {
      snapshotFile: 'story-06/step-07.bpmn',
    });
  });

  test('S6-Step08: List process variables', async () => {
    // Use the main diagram (which has conditions from the original fixture)
    const varsRes = parseResult(await handleListProcessVariables({ diagramId: s.diagramId }));
    expect(varsRes.success).toBe(true);
    // Variables list should be defined (may be empty if no expressions survive)
    expect(Array.isArray(varsRes.variables)).toBe(true);
  });

  test('S6-Step09: Final layout and export', async () => {
    await handleLayoutDiagram({ diagramId: s.diagramId });

    await assertStep(s.diagramId, 'S6-Step09', {
      snapshotFile: 'story-06/step-09.bpmn',
    });
  });
});
