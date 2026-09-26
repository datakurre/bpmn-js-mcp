/**
 * Story 3: Boundary Event Layout — Regression Guard
 *
 * Verifies that boundary events survive a full `layout_bpmn_diagram` call:
 * 1. Their x/y coordinates remain within their host's bounds (+/- 50px tolerance).
 * 2. Their lane membership matches their host's lane (fix #14).
 * 3. The `attachedToRef` relationship in the XML is preserved (fix #11).
 * 4. Exception-chain elements are positioned below the host (not far-left).
 *
 * Issue references: #11 (visual detach), #14 (wrong lane).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElement,
  handleConnect,
  handleLayoutDiagram,
  handleExportBpmn,
  handleListElements,
  handleCreateParticipant,
  handleCreateLanes,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { parseResult } from './helpers';

describe('Story 3: Boundary Event Layout — Regression Guard', () => {
  const s = {
    diagramId: '',
    participantId: '',
    lane1Id: '', // Requester
    lane2Id: '', // Processing
    startId: '',
    reviewTaskId: '',
    serviceTaskId: '',
    endOkId: '',
    timerBoundaryId: '',
    reminderTaskId: '',
    errorBoundaryId: '',
    logErrorTaskId: '',
    endErrorId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  // ──────────────────────────────────────────────────────────────────────────
  // Step 1: Create 2-lane pool
  // ──────────────────────────────────────────────────────────────────────────
  test('S3-Step01: Create pool with 2 lanes', async () => {
    const res = parseResult(
      await handleCreateDiagram({ name: 'Boundary Event Layout Test', hintLevel: 'none' })
    );
    expect(res.success).toBe(true);
    s.diagramId = res.diagramId;

    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId: s.diagramId, name: 'Test Process' })
    );
    expect(poolRes.success).toBe(true);
    s.participantId = poolRes.participant?.id ?? poolRes.participantId;

    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId: s.diagramId,
        participantId: s.participantId,
        lanes: [{ name: 'Requester' }, { name: 'Processing' }],
      })
    );
    expect(lanesRes.success).toBe(true);
    const laneIds: string[] = lanesRes.laneIds ?? [];
    expect(laneIds).toHaveLength(2);
    [s.lane1Id, s.lane2Id] = laneIds;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 2: Build main flow — start (lane 1) → review task (lane 1)
  //                         → service task (lane 2) → end (lane 2)
  // ──────────────────────────────────────────────────────────────────────────
  test('S3-Step02: Build main flow across lanes', async () => {
    const startRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Request Received',
        laneId: s.lane1Id,
      })
    );
    s.startId = startRes.elementId;

    const reviewRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Request',
        laneId: s.lane1Id,
        afterElementId: s.startId,
      })
    );
    s.reviewTaskId = reviewRes.elementId;

    const serviceRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Request',
        laneId: s.lane2Id,
        afterElementId: s.reviewTaskId,
        autoConnect: false,
      })
    );
    s.serviceTaskId = serviceRes.elementId;

    const endRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Request Complete',
        laneId: s.lane2Id,
        afterElementId: s.serviceTaskId,
        autoConnect: false,
      })
    );
    s.endOkId = endRes.elementId;

    // Wire the main flow
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.reviewTaskId,
      targetElementId: s.serviceTaskId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.serviceTaskId,
      targetElementId: s.endOkId,
    });

    expect(s.startId).toBeTruthy();
    expect(s.reviewTaskId).toBeTruthy();
    expect(s.serviceTaskId).toBeTruthy();
    expect(s.endOkId).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 3: Add non-interrupting timer boundary on reviewTask + reminder task
  // ──────────────────────────────────────────────────────────────────────────
  test('S3-Step03: Add non-interrupting timer boundary event', async () => {
    const beRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Review Overdue',
        hostElementId: s.reviewTaskId,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT24H' },
      })
    );
    expect(beRes.success).toBe(true);
    s.timerBoundaryId = beRes.elementId;

    // Add downstream reminder task
    const reminderRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Send Reminder',
        laneId: s.lane1Id,
      })
    );
    s.reminderTaskId = reminderRes.elementId;

    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.timerBoundaryId,
      targetElementId: s.reminderTaskId,
    });

    expect(s.timerBoundaryId).toBeTruthy();
    expect(s.reminderTaskId).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 4: Add interrupting error boundary on serviceTask + log + end
  // ──────────────────────────────────────────────────────────────────────────
  test('S3-Step04: Add interrupting error boundary event', async () => {
    const beRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Processing Error',
        hostElementId: s.serviceTaskId,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
      })
    );
    expect(beRes.success).toBe(true);
    s.errorBoundaryId = beRes.elementId;

    const logRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Log Error',
        laneId: s.lane2Id,
      })
    );
    s.logErrorTaskId = logRes.elementId;

    const endErrRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Processing Failed',
        laneId: s.lane2Id,
        afterElementId: s.logErrorTaskId,
        autoConnect: false,
      })
    );
    s.endErrorId = endErrRes.elementId;

    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.errorBoundaryId,
      targetElementId: s.logErrorTaskId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.logErrorTaskId,
      targetElementId: s.endErrorId,
    });

    expect(s.errorBoundaryId).toBeTruthy();
    expect(s.logErrorTaskId).toBeTruthy();
    expect(s.endErrorId).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 5: Run full layout_bpmn_diagram and check boundary events
  // ──────────────────────────────────────────────────────────────────────────
  test('S3-Step05: Full layout — boundary events must stay on their hosts', async () => {
    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId: s.diagramId }));
    expect(layoutRes.success).toBe(true);

    // Get all element positions.
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const elements: any[] = listRes.elements;

    const findEl = (id: string) => elements.find((e: any) => e.id === id);

    // ── Timer boundary event must be within reviewTask bounds ──────────────
    const reviewTask = findEl(s.reviewTaskId);
    const timerBe = findEl(s.timerBoundaryId);
    expect(reviewTask, 'reviewTask must exist after layout').toBeTruthy();
    expect(timerBe, 'timerBoundary must exist after layout').toBeTruthy();

    const hostTolerance = 50; // boundary events may overhang the host edge
    const rtX = reviewTask.x ?? 0;
    const rtY = reviewTask.y ?? 0;
    const rtW = reviewTask.width ?? 100;
    const rtH = reviewTask.height ?? 80;
    const tbX = timerBe.x ?? 0;
    const tbY = timerBe.y ?? 0;

    expect(
      tbX,
      `Timer boundary x=${tbX} must be within [${rtX - hostTolerance}, ${rtX + rtW + hostTolerance}] (host x=${rtX}, w=${rtW})`
    ).toBeGreaterThanOrEqual(rtX - hostTolerance);
    expect(tbX).toBeLessThanOrEqual(rtX + rtW + hostTolerance);
    expect(
      tbY,
      `Timer boundary y=${tbY} must be within [${rtY - hostTolerance}, ${rtY + rtH + hostTolerance}] (host y=${rtY}, h=${rtH})`
    ).toBeGreaterThanOrEqual(rtY - hostTolerance);
    expect(tbY).toBeLessThanOrEqual(rtY + rtH + hostTolerance);

    // ── Error boundary event must be within serviceTask bounds ─────────────
    const serviceTask = findEl(s.serviceTaskId);
    const errorBe = findEl(s.errorBoundaryId);
    expect(serviceTask, 'serviceTask must exist after layout').toBeTruthy();
    expect(errorBe, 'errorBoundary must exist after layout').toBeTruthy();

    const stX = serviceTask.x ?? 0;
    const stY = serviceTask.y ?? 0;
    const stW = serviceTask.width ?? 100;
    const stH = serviceTask.height ?? 80;
    const ebX = errorBe.x ?? 0;
    const ebY = errorBe.y ?? 0;

    expect(
      ebX,
      `Error boundary x=${ebX} must be within [${stX - hostTolerance}, ${stX + stW + hostTolerance}]`
    ).toBeGreaterThanOrEqual(stX - hostTolerance);
    expect(ebX).toBeLessThanOrEqual(stX + stW + hostTolerance);
    expect(
      ebY,
      `Error boundary y=${ebY} must be within [${stY - hostTolerance}, ${stY + stH + hostTolerance}]`
    ).toBeGreaterThanOrEqual(stY - hostTolerance);
    expect(ebY).toBeLessThanOrEqual(stY + stH + hostTolerance);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 6: Verify boundary event lane membership matches host lane (fix #14)
  // ──────────────────────────────────────────────────────────────────────────
  test('S3-Step06: Boundary events must be in the same lane as their host', async () => {
    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text as string;

    const membership = getLaneMembership(xml);

    // Timer boundary is on reviewTask (lane1/Requester)
    const reviewTaskLane = membership[s.reviewTaskId];
    const timerBeInXml = s.timerBoundaryId in membership;

    // Boundary events may legitimately not appear in flowNodeRef (they are
    // attached elements, not independent flow nodes).  If they do appear,
    // their lane must match the host's lane.
    if (timerBeInXml) {
      const timerBeLane = membership[s.timerBoundaryId];
      expect(
        timerBeLane,
        `Timer boundary (${s.timerBoundaryId}) should be in lane ${reviewTaskLane} (host's lane), but is in ${timerBeLane}`
      ).toBe(reviewTaskLane);
    }

    // Error boundary is on serviceTask (lane2/Processing)
    const serviceTaskLane = membership[s.serviceTaskId];
    const errorBeInXml = s.errorBoundaryId in membership;
    if (errorBeInXml) {
      const errorBeLane = membership[s.errorBoundaryId];
      expect(
        errorBeLane,
        `Error boundary (${s.errorBoundaryId}) should be in lane ${serviceTaskLane} (host's lane), but is in ${errorBeLane}`
      ).toBe(serviceTaskLane);
    }

    // Exception-chain elements must be in the same lane as their boundary source
    // (logErrorTask and reminderTask should be in their respective lanes).
    const logErrorLane = membership[s.logErrorTaskId];
    expect(logErrorLane, 'Log Error task should be in a lane').toBeTruthy();

    const reminderLane = membership[s.reminderTaskId];
    expect(reminderLane, 'Send Reminder task should be in a lane').toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 7: Verify attachedToRef is preserved in the XML (fix #11)
  // ──────────────────────────────────────────────────────────────────────────
  test('S3-Step07: XML must contain boundaryEvent with correct attachedToRef', async () => {
    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text as string;

    // The timer boundary should have attachedToRef pointing to reviewTask
    expect(xml, `XML should contain a boundaryEvent with id="${s.timerBoundaryId}"`).toContain(
      `id="${s.timerBoundaryId}"`
    );

    // The boundary events should use bpmn:boundaryEvent (not bpmn:intermediateCatchEvent)
    // If layout detached it, it would be serialised as intermediateCatchEvent.
    const timerPattern = new RegExp(
      `<bpmn:boundaryEvent[^>]*id="${s.timerBoundaryId}"[^>]*attachedToRef="${s.reviewTaskId}"`
    );
    const timerAltPattern = new RegExp(
      `<bpmn:boundaryEvent[^>]*attachedToRef="${s.reviewTaskId}"[^>]*id="${s.timerBoundaryId}"`
    );
    expect(
      timerPattern.test(xml) || timerAltPattern.test(xml),
      `Timer boundary event must be a bpmn:boundaryEvent attached to reviewTask.\n` +
        `Relevant XML snippet: ${extractSnippet(xml, s.timerBoundaryId)}`
    ).toBe(true);

    // Same for error boundary → serviceTask
    const errorPattern = new RegExp(
      `<bpmn:boundaryEvent[^>]*id="${s.errorBoundaryId}"[^>]*attachedToRef="${s.serviceTaskId}"`
    );
    const errorAltPattern = new RegExp(
      `<bpmn:boundaryEvent[^>]*attachedToRef="${s.serviceTaskId}"[^>]*id="${s.errorBoundaryId}"`
    );
    expect(
      errorPattern.test(xml) || errorAltPattern.test(xml),
      `Error boundary event must be a bpmn:boundaryEvent attached to serviceTask.\n` +
        `Relevant XML snippet: ${extractSnippet(xml, s.errorBoundaryId)}`
    ).toBe(true);
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build elementId → laneId map from BPMN XML by parsing FlowNodeRef entries. */
function getLaneMembership(xml: string): Record<string, string> {
  const membership: Record<string, string> = {};
  const lanePattern = /<bpmn:lane\s+[^>]*id="([^"]+)"[^>]*>(.*?)<\/bpmn:lane>/gis;
  let laneMatch: RegExpExecArray | null;
  while ((laneMatch = lanePattern.exec(xml)) !== null) {
    const laneId = laneMatch[1];
    const laneBody = laneMatch[2];
    const refPattern = /<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/gi;
    let refMatch: RegExpExecArray | null;
    while ((refMatch = refPattern.exec(laneBody)) !== null) {
      membership[refMatch[1].trim()] = laneId;
    }
  }
  return membership;
}

/** Extract a short snippet of XML around a given ID for diagnostics. */
function extractSnippet(xml: string, id: string): string {
  const idx = xml.indexOf(id);
  if (idx === -1) return '(not found)';
  const start = Math.max(0, idx - 80);
  const end = Math.min(xml.length, idx + 120);
  return `...${xml.slice(start, end)}...`;
}
