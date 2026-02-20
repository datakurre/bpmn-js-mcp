/**
 * Story 2: Helpdesk — Collaboration with Pools and Message Flows
 *
 * Covers: create_bpmn_participant (multi-pool), add_bpmn_element,
 * connect_bpmn_elements (message flows), manage_bpmn_root_elements,
 * set_bpmn_event_definition (message), set_bpmn_element_properties,
 * autosize_bpmn_pools_and_lanes, layout_bpmn_diagram, export_bpmn
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleCreateParticipant,
  handleAddElement,
  handleAddElementChain,
  handleConnect,
  handleManageRootElements,
  handleSetEventDefinition,
  handleSetProperties,
  handleAutosizePoolsAndLanes,
  handleLayoutDiagram,
  handleExportBpmn,
  handleImportXml,
  handleListElements,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { assertStep, parseResult } from './helpers';

describe('Story 2: Helpdesk — Collaboration with Pools and Message Flows', () => {
  const s = {
    diagramId: '',
    customerParticipantId: '',
    supportParticipantId: '',
    issueReportedId: '',
    submitTicketId: '',
    waitForResponseId: '',
    reviewResolutionId: '',
    resolvedGwId: '',
    doneId: '',
    requestClarificationId: '',
    messageFlowIds: [] as string[],
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  test('S2-Step01: Create collaboration with two pools', async () => {
    s.diagramId = await (async () => {
      const res = parseResult(await handleCreateDiagram({ name: 'Helpdesk Process' }));
      return res.diagramId as string;
    })();

    // Create multi-pool collaboration
    const collabRes = parseResult(
      await handleCreateParticipant({
        diagramId: s.diagramId,
        participants: [
          { name: 'Customer', collapsed: false, height: 350 },
          { name: 'Support System', collapsed: true },
        ],
      })
    );
    expect(collabRes.success).toBe(true);
    expect(collabRes.participantIds).toHaveLength(2);
    [s.customerParticipantId, s.supportParticipantId] = collabRes.participantIds as string[];

    // Verify pools exist
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const participants = (listRes.elements as any[]).filter(
      (e: any) => e.type === 'bpmn:Participant'
    );
    expect(participants.length).toBeGreaterThanOrEqual(2);

    await assertStep(s.diagramId, 'S2-Step01', {
      snapshotFile: 'story-02/step-01.bpmn',
    });
  });

  test('S2-Step02: Build the customer process', async () => {
    // Add elements to Customer pool using element chain (stop before EndEvent)
    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId: s.diagramId,
        participantId: s.customerParticipantId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Issue Reported' },
          { elementType: 'bpmn:SendTask', name: 'Submit Ticket' },
          { elementType: 'bpmn:IntermediateCatchEvent', name: 'Wait for Response' },
          { elementType: 'bpmn:UserTask', name: 'Review Resolution' },
          { elementType: 'bpmn:ExclusiveGateway', name: 'Resolved?' },
        ],
      })
    );
    expect(chainRes.success).toBe(true);

    [
      s.issueReportedId,
      s.submitTicketId,
      s.waitForResponseId,
      s.reviewResolutionId,
      s.resolvedGwId,
    ] = chainRes.elementIds as string[];

    // Add Done end event explicitly (not in chain to avoid unconditional auto-flow)
    const doneRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done',
        participantId: s.customerParticipantId,
        afterElementId: s.resolvedGwId,
        autoConnect: false,
      })
    );
    s.doneId = doneRes.elementId as string;

    // Set message event definition on "Wait for Response"
    await handleSetEventDefinition({
      diagramId: s.diagramId,
      elementId: s.waitForResponseId,
      eventDefinitionType: 'bpmn:MessageEventDefinition',
      messageRef: { id: 'Msg_SupportResponse', name: 'SupportResponse' },
    });

    // Add "No" path: Request Clarification → loop back to Wait for Response
    const requestClarRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:SendTask',
        name: 'Request Clarification',
        participantId: s.customerParticipantId,
        afterElementId: s.resolvedGwId,
        autoConnect: false,
      })
    );
    s.requestClarificationId = requestClarRes.elementId as string;

    // Connect: Resolved? → Done (Yes path)
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.resolvedGwId,
      targetElementId: s.doneId,
      label: 'Yes',
      conditionExpression: '${resolved == true}',
    });

    // Connect: Resolved? → Request Clarification (No path)
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.resolvedGwId,
      targetElementId: s.requestClarificationId,
      label: 'No',
      conditionExpression: '${resolved == false}',
    });

    // Loop back: Request Clarification → Wait for Response
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.requestClarificationId,
      targetElementId: s.waitForResponseId,
    });

    await assertStep(s.diagramId, 'S2-Step02', {
      containsElements: [
        'Issue Reported',
        'Submit Ticket',
        'Wait for Response',
        'Review Resolution',
        'Resolved?',
        'Done',
        'Request Clarification',
      ],
      snapshotFile: 'story-02/step-02.bpmn',
    });
  });

  test('S2-Step03: Add message flows', async () => {
    // Create shared message definitions
    await handleManageRootElements({
      diagramId: s.diagramId,
      messages: [
        { id: 'Msg_TicketSubmission', name: 'TicketSubmission' },
        { id: 'Msg_ClarificationRequest', name: 'ClarificationRequest' },
      ],
    });

    // Message flow: Submit Ticket → Support System
    const mf1Res = parseResult(
      await handleConnect({
        diagramId: s.diagramId,
        sourceElementId: s.submitTicketId,
        targetElementId: s.supportParticipantId,
      })
    );
    expect(mf1Res.connectionId).toBeDefined();

    // Message flow: Support System → Wait for Response
    const mf2Res = parseResult(
      await handleConnect({
        diagramId: s.diagramId,
        sourceElementId: s.supportParticipantId,
        targetElementId: s.waitForResponseId,
      })
    );
    expect(mf2Res.connectionId).toBeDefined();

    // Message flow: Request Clarification → Support System
    const mf3Res = parseResult(
      await handleConnect({
        diagramId: s.diagramId,
        sourceElementId: s.requestClarificationId,
        targetElementId: s.supportParticipantId,
      })
    );
    expect(mf3Res.connectionId).toBeDefined();

    s.messageFlowIds = [mf1Res.connectionId, mf2Res.connectionId, mf3Res.connectionId];

    // Verify message flows in XML
    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('messageFlow');

    await assertStep(s.diagramId, 'S2-Step03', {
      snapshotFile: 'story-02/step-03.bpmn',
    });
  });

  test('S2-Step04: Set external task properties on Submit Ticket', async () => {
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.submitTicketId,
      properties: {
        'camunda:type': 'external',
        'camunda:topic': 'ticket-submission',
      },
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('ticket-submission');

    await assertStep(s.diagramId, 'S2-Step04', {
      snapshotFile: 'story-02/step-04.bpmn',
    });
  });

  test('S2-Step05: Autosize pools and layout', async () => {
    await handleAutosizePoolsAndLanes({ diagramId: s.diagramId });
    await handleLayoutDiagram({ diagramId: s.diagramId });

    // Validate: 0 lint errors
    await assertStep(s.diagramId, 'S2-Step05', {
      lintErrorCount: 0,
      snapshotFile: 'story-02/step-05.bpmn',
    });
  });

  test('S2-Step06: Export and round-trip', async () => {
    const exportRes = await handleExportBpmn({
      format: 'xml',
      diagramId: s.diagramId,
      skipLint: true,
    });
    const xml = exportRes.content[0].text;
    expect(xml).toContain('<bpmn:definitions');

    const importRes = parseResult(await handleImportXml({ xml }));
    expect(importRes.success).toBe(true);

    await assertStep(importRes.diagramId as string, 'S2-Step06', {
      containsElements: ['Issue Reported', 'Submit Ticket', 'Wait for Response'],
      lintErrorCount: 0,
    });
  });
});
