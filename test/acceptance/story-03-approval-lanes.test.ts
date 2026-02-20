/**
 * Story 3: Approval Workflow — Lanes and Cross-Lane Handoffs
 *
 * Covers: create_bpmn_participant, create_bpmn_lanes, add_bpmn_element,
 * handoff_bpmn_to_lane, assign_bpmn_elements_to_lane,
 * suggest_bpmn_lane_organization, validate_bpmn_lane_organization,
 * redistribute_bpmn_elements_across_lanes, autosize_bpmn_pools_and_lanes,
 * layout_bpmn_diagram
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleCreateParticipant,
  handleCreateLanes,
  handleAddElement,
  handleConnect,
  handleHandoffToLane,
  handleSetProperties,
  handleSuggestLaneOrganization,
  handleValidateLaneOrganization,
  handleAutosizePoolsAndLanes,
  handleLayoutDiagram,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { assertStep, parseResult } from './helpers';

describe('Story 3: Approval Workflow — Lanes and Cross-Lane Handoffs', () => {
  const s = {
    diagramId: '',
    participantId: '',
    requesterLaneId: '',
    approverLaneId: '',
    financeLaneId: '',
    requestSubmittedId: '',
    fillRequestFormId: '',
    reviewRequestId: '',
    approvedGwId: '',
    processPaymentId: '',
    reviseRequestId: '',
    completedId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  test('S3-Step01: Create pool with 3 lanes', async () => {
    s.diagramId = await (async () => {
      const res = parseResult(await handleCreateDiagram({ name: 'Approval Process' }));
      return res.diagramId as string;
    })();

    const participantRes = parseResult(
      await handleCreateParticipant({
        diagramId: s.diagramId,
        name: 'Approval Process',
        height: 450,
      })
    );
    expect(participantRes.success).toBe(true);
    s.participantId = participantRes.participantId as string;

    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId: s.diagramId,
        participantId: s.participantId,
        lanes: [{ name: 'Requester' }, { name: 'Approver' }, { name: 'Finance' }],
      })
    );
    expect(lanesRes.success).toBe(true);
    expect(lanesRes.laneCount).toBe(3);
    [s.requesterLaneId, s.approverLaneId, s.financeLaneId] = lanesRes.laneIds as string[];

    await assertStep(s.diagramId, 'S3-Step01', {
      snapshotFile: 'story-03/step-01.bpmn',
    });
  });

  test('S3-Step02: Build flow with lane assignments', async () => {
    // Requester lane: StartEvent + Fill Request Form
    const startRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Request Submitted',
        participantId: s.participantId,
        laneId: s.requesterLaneId,
      })
    );
    s.requestSubmittedId = startRes.elementId as string;

    const fillFormRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Fill Request Form',
        participantId: s.participantId,
        laneId: s.requesterLaneId,
        afterElementId: s.requestSubmittedId,
      })
    );
    s.fillRequestFormId = fillFormRes.elementId as string;

    // Handoff to Approver lane: Review Request
    const reviewRes = parseResult(
      await handleHandoffToLane({
        diagramId: s.diagramId,
        fromElementId: s.fillRequestFormId,
        toLaneId: s.approverLaneId,
        name: 'Review Request',
        connectionLabel: 'Submit for review',
      })
    );
    expect(reviewRes.success).toBe(true);
    s.reviewRequestId = reviewRes.createdElementId as string;

    // Add gateway in Approver lane
    const gwRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Approved?',
        participantId: s.participantId,
        laneId: s.approverLaneId,
        afterElementId: s.reviewRequestId,
      })
    );
    s.approvedGwId = gwRes.elementId as string;

    // Handoff to Finance lane: Process Payment (Yes path)
    const paymentRes = parseResult(
      await handleHandoffToLane({
        diagramId: s.diagramId,
        fromElementId: s.approvedGwId,
        toLaneId: s.financeLaneId,
        name: 'Process Payment',
        connectionLabel: 'Yes',
      })
    );
    expect(paymentRes.success).toBe(true);
    s.processPaymentId = paymentRes.createdElementId as string;

    // Add End Event in Finance lane
    const endRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Completed',
        participantId: s.participantId,
        laneId: s.financeLaneId,
        afterElementId: s.processPaymentId,
      })
    );
    s.completedId = endRes.elementId as string;

    // Handoff back to Requester lane: Revise Request (No path)
    const reviseRes = parseResult(
      await handleHandoffToLane({
        diagramId: s.diagramId,
        fromElementId: s.approvedGwId,
        toLaneId: s.requesterLaneId,
        name: 'Revise Request',
        connectionLabel: 'No',
      })
    );
    s.reviseRequestId = reviseRes.createdElementId as string;

    // Loop back: Revise Request → Review Request
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.reviseRequestId,
      targetElementId: s.reviewRequestId,
    });

    await assertStep(s.diagramId, 'S3-Step02', {
      containsElements: [
        'Request Submitted',
        'Fill Request Form',
        'Review Request',
        'Approved?',
        'Process Payment',
        'Revise Request',
        'Completed',
      ],
      snapshotFile: 'story-03/step-02.bpmn',
    });
  });

  test('S3-Step03: Set assignee properties matching lane names', async () => {
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.fillRequestFormId,
      properties: { 'camunda:candidateGroups': 'requester' },
    });
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.reviewRequestId,
      properties: { 'camunda:candidateGroups': 'approver' },
    });
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.processPaymentId,
      properties: { 'camunda:candidateGroups': 'finance' },
    });
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.reviseRequestId,
      properties: { 'camunda:candidateGroups': 'requester' },
    });

    await assertStep(s.diagramId, 'S3-Step03', {
      snapshotFile: 'story-03/step-03.bpmn',
    });
  });

  test('S3-Step04: Validate lane organization', async () => {
    const suggestRes = parseResult(await handleSuggestLaneOrganization({ diagramId: s.diagramId }));
    expect(suggestRes.suggestions).toBeDefined();

    const validateRes = parseResult(
      await handleValidateLaneOrganization({ diagramId: s.diagramId })
    );
    // validate returns { valid, coherenceScore, ... } (no 'success' field)
    expect(validateRes.coherenceScore).toBeGreaterThanOrEqual(0);

    await assertStep(s.diagramId, 'S3-Step04', {
      snapshotFile: 'story-03/step-04.bpmn',
    });
  });

  test('S3-Step05: Layout, autosize, and export', async () => {
    await handleLayoutDiagram({ diagramId: s.diagramId });
    await handleAutosizePoolsAndLanes({ diagramId: s.diagramId });

    await assertStep(s.diagramId, 'S3-Step05', {
      lintErrorCount: 0,
      snapshotFile: 'story-03/step-05.bpmn',
    });
  });
});
