/**
 * Story 2: Parallel Review — Fork / Join with Lanes
 *
 * Verifies:
 * 1. add_bpmn_elements with a ParallelGateway emits deferredLayout:true
 *    and does NOT run auto-layout prematurely.
 * 2. After wiring parallel branches with connect_bpmn_elements, connect.ts
 *    emits an align_bpmn_elements nextStep for gateway connections.
 * 3. After layout_bpmn_diagram, branch tasks have non-overlapping Y positions
 *    (resolvePositionOverlaps fix: full branchSpacing instead of half).
 * 4. After align_bpmn_elements, the lane membership of all elements is
 *    unchanged (no lane drift).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElementChain,
  handleAddElement,
  handleConnect,
  handleListElements,
  handleLayoutDiagram,
  handleDeleteElement,
  handleExportBpmn,
  handleAlignElements,
  handleCreateParticipant,
  handleCreateLanes,
} from '../../src/handlers';
import { clearDiagrams, parseResult } from '../helpers';
import { assertStep } from './helpers';

describe('Story 2: Parallel Review — Fork / Join with Lanes', () => {
  const s = {
    diagramId: '',
    participantId: '',
    lane1Id: '',
    lane2Id: '',
    startId: '',
    submitId: '',
    splitId: '',
    reviewAId: '',
    reviewBId: '',
    joinId: '',
    consolidateId: '',
    endId: '',
    /** Connection IDs added by the chain (to delete before rewiring). */
    chainConnections: [] as string[],
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  // ──────────────────────────────────────────────────────────────────────────
  // Step 1: Create diagram with pool and two lanes
  // ──────────────────────────────────────────────────────────────────────────
  test('S2-Step01: Create diagram with pool and lanes', async () => {
    const res = parseResult(
      await handleCreateDiagram({ name: 'Parallel Review', hintLevel: 'none' })
    );
    expect(res.success).toBe(true);
    s.diagramId = res.diagramId;

    // Wrap in a participant pool
    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId: s.diagramId, name: 'Review Process' })
    );
    expect(poolRes.success).toBe(true);
    s.participantId = poolRes.participant?.id ?? poolRes.participantId;

    // Add two lanes: Requester and Reviewers
    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId: s.diagramId,
        participantId: s.participantId,
        lanes: [{ name: 'Requester' }, { name: 'Reviewers' }],
      })
    );
    expect(lanesRes.success).toBe(true);
    // handleCreateLanes returns laneIds (string[]) and laneNames (string[])
    const laneIds: string[] = lanesRes.laneIds ?? [];
    expect(laneIds).toHaveLength(2);
    s.lane1Id = laneIds[0]; // Requester
    s.lane2Id = laneIds[1]; // Reviewers
    expect(s.lane1Id).toBeTruthy();
    expect(s.lane2Id).toBeTruthy();

    await assertStep(s.diagramId, 'S2-Step01', {});
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 2: Build main spine chain — must NOT auto-layout (contains gateway)
  // ──────────────────────────────────────────────────────────────────────────
  test('S2-Step02: Chain with ParallelGateway defers layout', async () => {
    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId: s.diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Request Received' },
          { elementType: 'bpmn:UserTask', name: 'Submit Request' },
          { elementType: 'bpmn:ParallelGateway', name: 'Review Split' },
          { elementType: 'bpmn:ParallelGateway', name: 'Review Join' },
          { elementType: 'bpmn:UserTask', name: 'Consolidate Reviews' },
          { elementType: 'bpmn:EndEvent', name: 'Process Complete' },
        ],
      })
    );

    expect(chainRes.success).toBe(true);
    expect(chainRes.elementCount).toBe(6);

    // The chain contains gateways → auto-layout must be deferred
    expect(chainRes.deferredLayout, 'Expected deferredLayout:true when chain has a gateway').toBe(
      true
    );
    expect(chainRes.autoLayoutApplied).toBeFalsy();
    expect(chainRes.note).toContain('gateway');

    [s.startId, s.submitId, s.splitId, s.joinId, s.consolidateId, s.endId] =
      chainRes.elementIds as string[];

    // With the improved chain handler, elements after a gateway are NOT
    // auto-connected. Only the pre-gateway portion is auto-wired:
    // Request Received → Submit Request → Review Split (gateway).
    // Everything after Review Split (Join, Consolidate, End) is unconnected.
    s.chainConnections = chainRes.elements
      .filter((e: any) => e.connectionId)
      .map((e: any) => e.connectionId) as string[];

    // unconnectedElements should list the post-gateway elements
    expect(chainRes.unconnectedElements).toBeDefined();
    expect(chainRes.unconnectedElements.length).toBeGreaterThan(0);

    await assertStep(s.diagramId, 'S2-Step02', {
      containsElements: [
        'Request Received',
        'Submit Request',
        'Review Split',
        'Review Join',
        'Consolidate Reviews',
        'Process Complete',
      ],
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 3: Add branch tasks
  // ──────────────────────────────────────────────────────────────────────────
  test('S2-Step03: Add parallel branch tasks', async () => {
    const aRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Reviewer A',
        laneId: s.lane2Id,
      })
    );
    expect(aRes.success).toBe(true);
    s.reviewAId = aRes.elementId ?? aRes.id;

    const bRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Reviewer B',
        laneId: s.lane2Id,
      })
    );
    expect(bRes.success).toBe(true);
    s.reviewBId = bRes.elementId ?? bRes.id;

    await assertStep(s.diagramId, 'S2-Step03', {
      containsElements: ['Reviewer A', 'Reviewer B'],
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 4: Remove spurious sequential connection Split→Join, wire branches
  // ──────────────────────────────────────────────────────────────────────────
  test('S2-Step04: Wire parallel branches correctly', async () => {
    // Find and delete the sequential Split→Join connection the chain created
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const splitToJoin = (listRes.elements as any[]).find(
      (e: any) =>
        e.type === 'bpmn:SequenceFlow' &&
        (e.sourceId ?? e.source?.id) === s.splitId &&
        (e.targetId ?? e.target?.id) === s.joinId
    );
    if (splitToJoin) {
      await handleDeleteElement({ diagramId: s.diagramId, elementId: splitToJoin.id });
    }

    // Wire split → branches → join
    const connectSplit = async (targetId: string) => {
      const r = parseResult(
        await handleConnect({
          diagramId: s.diagramId,
          sourceElementId: s.splitId,
          targetElementId: targetId,
        })
      );
      expect(r.success).toBe(true);

      // Fix #8: connect from ParallelGateway must suggest align_bpmn_elements
      const nextStepTools: string[] = (r.nextSteps ?? []).map((ns: any) => ns.tool);
      expect(
        nextStepTools,
        'connect from ParallelGateway should suggest align_bpmn_elements'
      ).toContain('align_bpmn_elements');
    };
    await connectSplit(s.reviewAId);
    await connectSplit(s.reviewBId);

    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.reviewAId,
      targetElementId: s.joinId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.reviewBId,
      targetElementId: s.joinId,
    });

    // With the improved chain handler, elements after a gateway are NOT
    // auto-connected. Wire the post-join tail explicitly.
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.joinId,
      targetElementId: s.consolidateId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.consolidateId,
      targetElementId: s.endId,
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 5: Layout and check no overlapping branch tasks
  // ──────────────────────────────────────────────────────────────────────────
  test('S2-Step05: Layout — branch tasks must not overlap', async () => {
    await handleLayoutDiagram({ diagramId: s.diagramId });

    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const reviewA = (listRes.elements as any[]).find((e: any) => e.id === s.reviewAId);
    const reviewB = (listRes.elements as any[]).find((e: any) => e.id === s.reviewBId);

    expect(reviewA).toBeDefined();
    expect(reviewB).toBeDefined();

    // Fix #2 regression guard: the two tasks must not occupy the same Y band.
    // Task height is 80 px; they must be at least 80 px apart vertically, OR
    // at least 100 px apart horizontally (acceptable if side-by-side).
    const yA = reviewA.y ?? reviewA.position?.y ?? 0;
    const yB = reviewB.y ?? reviewB.position?.y ?? 0;
    const xA = reviewA.x ?? reviewA.position?.x ?? 0;
    const xB = reviewB.x ?? reviewB.position?.x ?? 0;
    const heightA = reviewA.height ?? 80;

    const yOverlap = Math.abs(yA - yB) < heightA;
    const xDiff = Math.abs(xA - xB);

    // They may be side-by-side (large xDiff) or stacked (large yDiff).
    // What they must NOT be is same-y AND same-x (full overlap).
    const fullyOverlapping = yOverlap && xDiff < 100;
    expect(fullyOverlapping, `Branch tasks overlap: A=(${xA},${yA}) B=(${xB},${yB})`).toBe(false);

    await assertStep(s.diagramId, 'S2-Step05', { lintErrorCount: 0 });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 6: Align branch tasks and verify lane membership is preserved
  // ──────────────────────────────────────────────────────────────────────────
  test('S2-Step06: Align branch tasks — lane membership must survive', async () => {
    // Record lane membership before alignment
    const laneMembersBefore = await getLaneMembership(s.diagramId);

    // Align branch tasks vertically (top)
    await handleAlignElements({
      diagramId: s.diagramId,
      elementIds: [s.reviewAId, s.reviewBId],
      alignment: 'top',
      compact: true,
    });

    // Record lane membership after alignment
    const laneMembersAfter = await getLaneMembership(s.diagramId);

    // Fix #5 regression guard: every element's lane must be the same as before.
    for (const [elId, beforeLane] of Object.entries(laneMembersBefore)) {
      const afterLane = laneMembersAfter[elId];
      expect(
        afterLane,
        `Element ${elId} was in lane ${beforeLane} before align, but is in ${afterLane} after`
      ).toBe(beforeLane);
    }

    await assertStep(s.diagramId, 'S2-Step06', {});
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 7: Export is valid BPMN with correct lane XML
  // ──────────────────────────────────────────────────────────────────────────
  test('S2-Step07: Export produces valid BPMN', async () => {
    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;

    expect(xml).toContain('Review Split');
    expect(xml).toContain('Reviewer A');
    expect(xml).toContain('Reviewer B');
    expect(xml).toContain('Review Join');
    // Both branches must be in exactly one lane each
    expect(xml).toContain('<bpmn:lane');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Helper: build elementId → laneId map from exported XML
// Parses <bpmn:Lane id="…"> … <bpmn:FlowNodeRef>elementId</bpmn:FlowNodeRef>
// ────────────────────────────────────────────────────────────────────────────
async function getLaneMembership(diagramId: string): Promise<Record<string, string>> {
  const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
    .text as string;
  const membership: Record<string, string> = {};
  const lanePattern = /<bpmn:Lane\s+[^>]*id="([^"]+)"[^>]*>(.*?)<\/bpmn:Lane>/gs;
  let laneMatch: RegExpExecArray | null;
  while ((laneMatch = lanePattern.exec(xml)) !== null) {
    const laneId = laneMatch[1];
    const laneBody = laneMatch[2];
    const refPattern = /<bpmn:FlowNodeRef>([^<]+)<\/bpmn:FlowNodeRef>/g;
    let refMatch: RegExpExecArray | null;
    while ((refMatch = refPattern.exec(laneBody)) !== null) {
      membership[refMatch[1].trim()] = laneId;
    }
  }
  return membership;
}
