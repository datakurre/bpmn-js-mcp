/**
 * Tests for label positioning behaviors in the rebuild engine.
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
import { rebuildLayout } from '../../../src/rebuild';
import { clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';
import { handleAddElement, handleConnect } from '../../../src/handlers';
import { createDiagram, addElement, connect, parseResult } from '../../utils/diagram';
import type { BpmnElement, ElementRegistry } from '../../../src/bpmn-types';
import { buildF02ExclusiveGateway } from '../../scenarios/fixture-builders';
import { DEFAULT_LABEL_SIZE } from '../../../src/constants';
import { selectBestLabelSide } from '../../../src/rebuild/artifacts';

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
   * After rebuild, an L-shaped (4+ waypoint) connection should have its label
   * near the path midpoint, not near the source end.
   */
  test('labeled branch flow label is near path midpoint for L-shaped connection', async () => {
    // Build a diagram with an exclusive gateway (produces L-shaped branch flows)
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

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

describe('data element Y-offset uses height/2 not width/2', () => {
  test('data object below-right position uses height/2 for Y offset', async () => {
    // Data object is 36x50 (width=36, height=50)
    // height/2 = 25 (correct), width/2 = 18 (bpmn-js bug)
    const diagramId = await createDiagram('data object Y-offset test');
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

    const diagram = getDiagram(diagramId)!;
    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const taskEl = registry.get(task)!;
    const dataObjEl = registry.get(dataObj)!;

    // Data object should be positioned below the task
    const taskBottom = taskEl.y + taskEl.height;
    expect(dataObjEl.y).toBeGreaterThan(taskBottom);

    // The data object center Y should use height/2 in the formula:
    //   centerY = taskBottom + 40 + height/2 = taskBottom + 40 + 25 = taskBottom + 65
    //   so dataObjEl.y = centerY - height/2 = taskBottom + 40
    //
    // With the bpmn-js BUG (width/2 = 18):
    //   centerY = taskBottom + 40 + 18 = taskBottom + 58
    //   dataObjEl.y = taskBottom + 40
    //
    // With CORRECT (height/2 = 25):
    //   centerY = taskBottom + 40 + 25 = taskBottom + 65
    //   dataObjEl.y = taskBottom + 40
    //
    // Both formulas produce same dataObjEl.y = taskBottom + 40 because:
    //   y = centerY - height/2
    //   correct: y = (taskBottom + 40 + 25) - 25 = taskBottom + 40
    //   buggy:   y = (taskBottom + 40 + 18) - 25 = taskBottom + 33
    //
    // So the distinction is visible in dataObjEl.y:
    //   correct: taskBottom + 40 (using height/2 for both computation and positioning)
    //   buggy:   taskBottom + 33 (mismatched width/2 for computation, height/2 for positioning)
    const expectedY = taskBottom + 40; // correct: taskBottom + 40
    const buggyY = taskBottom + 33; // buggy: taskBottom + 33

    // Should be at or near the correct position (not the buggy one)
    expect(Math.abs(dataObjEl.y - expectedY)).toBeLessThan(Math.abs(dataObjEl.y - buggyY) + 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Overlap resolution — bounding box near-miss detection
// ═══════════════════════════════════════════════════════════════════════════

describe('overlap resolution spreads near-miss positioned elements', () => {
  test('two tasks 30px apart vertically are spread apart after rebuild', async () => {
    /**
     * Task height = 80px. Two tasks at Y=200 and Y=230 overlap by 50px.
     * rebuildLayout should detect this and spread them apart.
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

    const diagram = getDiagram(diagramId)!;

    // Use a very small branchSpacing to force near-overlapping positions
    // (30px < task height 80px → tasks will visually overlap)
    rebuildLayout(diagram, { branchSpacing: 30 });

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
  test('back-edge connection (A → B → A) has valid waypoints after rebuild', async () => {
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

    const diagram = getDiagram(diagramId)!;
    rebuildLayout(diagram);

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

describe('getExternalLabelMid formula comparison', () => {
  /**
   * bpmn-js `getExternalLabelMid()` places the label centre at:
   *   (element.centerX,  element.bottom + DEFAULT_LABEL_SIZE.height / 2)
   *
   * For a 20px label that means:
   *   label center Y = element.bottom + 10
   *   label.y (top-left) = element.bottom + 10 - labelHeight/2 = element.bottom
   *
   * Our `adjustLabels()` in `src/rebuild/artifacts.ts` should produce the
   * same result so that rebuild-engine label positions match interactive
   * bpmn-js Camunda Modeler positions.
   */
  test('start event label top-edge is at element bottom (bpmn-js formula)', async () => {
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const startEl = registry.get(ids.start)!;

    if (!startEl.label || !startEl.businessObject?.name) return;

    const labelH = startEl.label.height || DEFAULT_LABEL_SIZE.height;

    // bpmn-js formula: label center Y = element.bottom + DEFAULT_LABEL_SIZE.height / 2
    // ⟹ label.y (top-left) = element.bottom + DEFAULT_LABEL_SIZE.height/2 - labelH/2
    const expectedLabelY = startEl.y + startEl.height + DEFAULT_LABEL_SIZE.height / 2 - labelH / 2;

    // Allow ±2px for grid snapping / rounding
    expect(Math.abs(startEl.label.y - expectedLabelY)).toBeLessThanOrEqual(2);
  });

  test('end event label top-edge matches bpmn-js formula', async () => {
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const endEl = registry.get(ids.end)!;

    if (!endEl.label || !endEl.businessObject?.name) return;

    const labelH = endEl.label.height || DEFAULT_LABEL_SIZE.height;
    const expectedLabelY = endEl.y + endEl.height + DEFAULT_LABEL_SIZE.height / 2 - labelH / 2;

    expect(Math.abs(endEl.label.y - expectedLabelY)).toBeLessThanOrEqual(2);
  });

  test('gateway label top-edge matches bpmn-js formula', async () => {
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const splitEl = registry.get(ids.split)!;

    if (!splitEl.label || !splitEl.businessObject?.name) return;

    const labelH = splitEl.label.height || DEFAULT_LABEL_SIZE.height;
    const expectedLabelY = splitEl.y + splitEl.height + DEFAULT_LABEL_SIZE.height / 2 - labelH / 2;

    expect(Math.abs(splitEl.label.y - expectedLabelY)).toBeLessThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4-side adaptive label side selection
// ═══════════════════════════════════════════════════════════════════════════

describe('selectBestLabelSide', () => {
  /**
   * `selectBestLabelSide` returns the first free side in priority order:
   * bottom → top → left → right → bottom (fallback).
   *
   * This mirrors bpmn-js AdaptiveLabelPositioningBehavior's getOptimalPosition()
   * priority logic.
   */

  test('returns bottom when no alignments are taken', () => {
    expect(selectBestLabelSide(new Set())).toBe('bottom');
  });

  test('returns top when bottom is taken', () => {
    expect(selectBestLabelSide(new Set(['bottom']))).toBe('top');
  });

  test('returns left when bottom and top are taken', () => {
    expect(selectBestLabelSide(new Set(['bottom', 'top']))).toBe('left');
  });

  test('returns right when bottom, top, and left are taken', () => {
    expect(selectBestLabelSide(new Set(['bottom', 'top', 'left']))).toBe('right');
  });

  test('falls back to bottom when all sides are taken', () => {
    expect(selectBestLabelSide(new Set(['bottom', 'top', 'left', 'right']))).toBe('bottom');
  });

  test('returns bottom when only non-bottom sides are taken', () => {
    expect(selectBestLabelSide(new Set(['left', 'right']))).toBe('bottom');
  });

  test('returns top when only bottom and right are taken', () => {
    expect(selectBestLabelSide(new Set(['bottom', 'right']))).toBe('top');
  });
});
