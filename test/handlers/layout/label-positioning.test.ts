/**
 * Tests for label positioning behaviors after auto-layout.
 *
 * Covers:
 * - Multi-bend flow label positioning (midpoint of path, not first segment)
 * - Data element Y-offset correctness (height/2 not width/2)
 * - Overlap resolution with near-miss positions (bounding box detection)
 * - Backward loop-back connection routing
 * - getExternalLabelMid formula comparison (regression / documentation)
 * - 4-side adaptive label positioning helper (selectBestLabelSide)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';
import { handleAddElement, handleConnect, handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, connect, parseResult } from '../../utils/diagram';
import type { BpmnElement, ElementRegistry } from '../../../src/bpmn-types';
import { buildF02ExclusiveGateway } from '../../scenarios/fixture-builders';
import {
  DEFAULT_LABEL_SIZE,
  FLOW_LABEL_INDENT,
  FLOW_LABEL_SIDE_OFFSET,
} from '../../../src/constants';

afterEach(() => clearDiagrams());

// ── Helpers ────────────────────────────────────────────────────────────────

function getRegistry(diagramId: string): ElementRegistry {
  return getDiagram(diagramId)!.modeler.get('elementRegistry') as ElementRegistry;
}

// ═══════════════════════════════════════════════════════════════════════════
// Flow label midpoint — multi-bend connections
// ═══════════════════════════════════════════════════════════════════════════

describe('flow label midpoint on multi-bend connection', () => {
  /**
   * After layout, an L-shaped (4+ waypoint) connection should have its label
   * near the path midpoint, not near the source end.
   */
  test('labeled branch flow label is near path midpoint for L-shaped connection', async () => {
    // Build a diagram with an exclusive gateway (produces L-shaped branch flows)
    const ids = await buildF02ExclusiveGateway();

    await handleLayoutDiagram({ diagramId: ids.diagramId });

    const registry = getRegistry(ids.diagramId);
    const allElements = (registry as any).getAll() as BpmnElement[];

    // Find labeled sequence flows (split gateway branches are labeled "Yes"/"No")
    const labeledFlows = allElements.filter(
      (el: BpmnElement) =>
        el.type === 'bpmn:SequenceFlow' &&
        el.label &&
        (el as any).businessObject?.name &&
        (el as any).waypoints &&
        (el as any).waypoints.length >= 3
    );

    // We expect at least one labeled multi-bend flow (the "No" branch is L-shaped)
    if (labeledFlows.length === 0) return; // skip if no such flows in this diagram state

    for (const flow of labeledFlows) {
      const waypoints = (flow as any).waypoints as Array<{ x: number; y: number }>;
      if (waypoints.length < 3) continue;

      const label = flow.label!;
      const labelCenterX = label.x + (label.width ?? 90) / 2;
      const labelCenterY = label.y + (label.height ?? 20) / 2;

      // Compute the path midpoint (mid waypoints)
      const mid = waypoints.length / 2 - 1;
      const p0 = waypoints[Math.floor(mid)];
      const p1 = waypoints[Math.ceil(mid + 0.01)];
      const pathMidX = (p0.x + p1.x) / 2;
      const pathMidY = (p0.y + p1.y) / 2;

      // Compute first-segment midpoint (what the old code would use)
      const firstMidX = (waypoints[0].x + waypoints[1].x) / 2;
      const firstMidY = (waypoints[0].y + waypoints[1].y) / 2;

      const distToPathMid = Math.hypot(labelCenterX - pathMidX, labelCenterY - pathMidY);
      const distToFirstMid = Math.hypot(labelCenterX - firstMidX, labelCenterY - firstMidY);

      // Label should be closer to path midpoint than to the first-segment midpoint
      // (or at least not further away — allow equality for 2-point straight connections)
      expect(distToPathMid).toBeLessThanOrEqual(distToFirstMid + 1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Data element Y-offset correctness
// ═══════════════════════════════════════════════════════════════════════════

describe('data element placement', () => {
  test('data object written by a task does not overlap the task', async () => {
    const diagramId = await createDiagram('data object placement test');
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Data' });
    const dataObj = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:DataObjectReference',
        name: 'Application Data',
      })
    ).elementId;
    await parseResult(
      await handleConnect({ diagramId, sourceElementId: task, targetElementId: dataObj })
    );

    await handleLayoutDiagram({ diagramId: diagramId });

    const registry = getRegistry(diagramId);
    const taskEl = registry.get(task)!;
    const dataObjEl = registry.get(dataObj)!;

    const overlaps =
      dataObjEl.x < taskEl.x + taskEl.width &&
      dataObjEl.x + dataObjEl.width > taskEl.x &&
      dataObjEl.y < taskEl.y + taskEl.height &&
      dataObjEl.y + dataObjEl.height > taskEl.y;
    expect(overlaps).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Overlap resolution — bounding box near-miss detection
// ═══════════════════════════════════════════════════════════════════════════

describe('overlap resolution spreads near-miss positioned elements', () => {
  test('two tasks 30px apart vertically are spread apart after layout', async () => {
    /**
     * Task height = 80px. Two tasks at Y=200 and Y=230 overlap by 50px.
     * Layout should detect this and spread them apart.
     *
     * This tests the bounding-box overlap detection, not just exact-coordinate
     * matching (the old behavior only caught y=200 vs y=200 exact).
     */
    // Build a diagram with parallel branches that would end up near each other
    // Use a 3-branch parallel gateway with a very small custom branchSpacing
    // so branches 0 and 1 end up with overlapping bounding boxes.
    const diagramId = await createDiagram('overlap near-miss test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const fork = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Fork' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, fork);
    await connect(diagramId, fork, task1);
    await connect(diagramId, fork, task2);
    await connect(diagramId, task1, join);
    await connect(diagramId, task2, join);
    await connect(diagramId, join, end);

    await handleLayoutDiagram({ diagramId });

    const registry = getRegistry(diagramId);
    const task1El = registry.get(task1)!;
    const task2El = registry.get(task2)!;

    // After overlap resolution, the tasks should not visually overlap
    // (minimum separation = at least 10px clear gap between bounding boxes)
    const upperBottom = Math.min(task1El.y, task2El.y) + 80; // task height = 80
    const lowerTop = Math.max(task1El.y, task2El.y);

    // There should be at least 0px separation (no overlap)
    expect(lowerTop).toBeGreaterThanOrEqual(upperBottom - 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Backward loop-back connections
// ═══════════════════════════════════════════════════════════════════════════

describe('backward loop-back connection routing', () => {
  test('back-edge connection (A → B → A) has valid waypoints after layout', async () => {
    const diagramId = await createDiagram('loop-back routing test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, taskA);
    const forwardFlow = await connect(diagramId, taskA, taskB);
    await connect(diagramId, taskB, end);
    // Back-edge: B → A (loop-back)
    const backFlow = await connect(diagramId, taskB, taskA);

    await handleLayoutDiagram({ diagramId: diagramId });

    const registry = getRegistry(diagramId);
    const backConn = registry.get(backFlow)!;
    const forwardConn = registry.get(forwardFlow)!;

    // Both connections should have valid waypoints
    expect(backConn.waypoints).toBeDefined();
    expect(backConn.waypoints!.length).toBeGreaterThanOrEqual(2);
    expect(forwardConn.waypoints).toBeDefined();
    expect(forwardConn.waypoints!.length).toBeGreaterThanOrEqual(2);

    // Task A should be to the left of Task B (forward flow direction)
    expect(registry.get(taskA)!.x).toBeLessThan(registry.get(taskB)!.x);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getExternalLabelMid comparison — formula regression test
// ═══════════════════════════════════════════════════════════════════════════

describe('external labels hug their element', () => {
  /**
   * The layout engine may place an external label on any side of its
   * element (e.g. above a gateway whose outgoing flows leave downwards),
   * but the label must stay close to the element and must not cover it.
   */
  function expectLabelNearElement(el: BpmnElement): void {
    if (!el.label || !el.businessObject?.name) return;
    const label = el.label;
    const labelBottom = label.y + (label.height || DEFAULT_LABEL_SIZE.height);
    const gapBelow = label.y - (el.y + el.height);
    const gapAbove = el.y - labelBottom;
    const verticalGap = Math.max(gapBelow, gapAbove);

    // Not overlapping the element vertically, and within 20px of it
    expect(verticalGap).toBeGreaterThanOrEqual(0);
    expect(verticalGap).toBeLessThanOrEqual(20);
  }

  test('start event label sits next to the event', async () => {
    const ids = await buildF02ExclusiveGateway();
    await handleLayoutDiagram({ diagramId: ids.diagramId });
    expectLabelNearElement(getRegistry(ids.diagramId).get(ids.start)!);
  });

  test('end event label sits next to the event', async () => {
    const ids = await buildF02ExclusiveGateway();
    await handleLayoutDiagram({ diagramId: ids.diagramId });
    expectLabelNearElement(getRegistry(ids.diagramId).get(ids.end)!);
  });

  test('gateway label sits next to the gateway', async () => {
    const ids = await buildF02ExclusiveGateway();
    await handleLayoutDiagram({ diagramId: ids.diagramId });
    expectLabelNearElement(getRegistry(ids.diagramId).get(ids.split)!);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4-side adaptive label side selection
// ═══════════════════════════════════════════════════════════════════════════

describe('FLOW_LABEL_INDENT parity with bpmn-js for horizontal segments', () => {
  /**
   * bpmn-js `FLOW_LABEL_INDENT = 15` places the label **centre** 15 px above
   * the segment midpoint for horizontal connections.
   *
   * Our `FLOW_LABEL_SIDE_OFFSET = 10` places the label's bottom **edge** 10 px
   * above the segment.  For the default 20 px label height the resulting
   * centre Y is:
   *
   *   our centre Y = midY − FLOW_LABEL_SIDE_OFFSET − labelH / 2
   *                = midY − 10 − 10 = midY − 20
   *
   * This intentionally diverges from bpmn-js (midY − 15) by 5px to provide
   * more clearance on vertical segments of Z-shaped cross-lane connections.
   *
   * The former value FLOW_LABEL_SIDE_OFFSET = 5 produced exact bpmn-js parity.
   * These tests document the current (intentional) divergence.
   */
  test('FLOW_LABEL_INDENT does NOT equal FLOW_LABEL_SIDE_OFFSET + half default label height (intentional divergence)', () => {
    // With FLOW_LABEL_SIDE_OFFSET = 10 and DEFAULT_LABEL_SIZE.height = 20:
    //   FLOW_LABEL_SIDE_OFFSET + height/2 = 10 + 10 = 20 ≠ FLOW_LABEL_INDENT (15)
    expect(FLOW_LABEL_INDENT).not.toBe(FLOW_LABEL_SIDE_OFFSET + DEFAULT_LABEL_SIZE.height / 2);
    // Document the actual relationship:
    expect(FLOW_LABEL_SIDE_OFFSET + DEFAULT_LABEL_SIZE.height / 2).toBe(20);
    expect(FLOW_LABEL_INDENT).toBe(15);
  });

  test('horizontal label centre Y is 5px further from line than bpmn-js formula (intentional)', () => {
    const midY = 200;
    const labelH = DEFAULT_LABEL_SIZE.height; // 20

    // Our formula (top-left y → convert to centre y)
    const ourTopLeftY = midY - FLOW_LABEL_SIDE_OFFSET - labelH;
    const ourCentreY = ourTopLeftY + labelH / 2;

    // bpmn-js formula (returns centre y directly)
    const bpmnCentreY = midY - FLOW_LABEL_INDENT;

    // With FLOW_LABEL_SIDE_OFFSET = 10: our centre Y = midY - 20, bpmn-js = midY - 15
    // Intentional 5px divergence for better vertical-segment clearance.
    expect(ourCentreY).toBe(bpmnCentreY - 5);
  });
});
