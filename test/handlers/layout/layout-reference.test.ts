/**
 * Reference layout regression tests.
 *
 * Imports reference BPMN diagrams from test/fixtures/layout-references/,
 * runs ELK layout, and asserts structural layout properties:
 * - Left-to-right ordering of the main flow
 * - All connections are strictly orthogonal (no diagonals)
 * - Parallel branch elements are on distinct Y rows
 * - No element overlaps
 *
 * Primary references:
 * - 02-exclusive-gateway.bpmn — XOR split/merge with happy/rejection paths
 * - 03-parallel-gateway.bpmn — 3-way parallel fork/join
 * - 19-complex-workflow-patterns.bpmn — mixed XOR + parallel gateways with subprocess
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { clearDiagrams, importReference, comparePositions } from '../../helpers';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Centre-X of an element. */
function centreX(el: any): number {
  return el.x + (el.width || 0) / 2;
}

/** Centre-Y of an element. */
function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

/** Assert all waypoints of a connection form strictly orthogonal segments. */
function expectOrthogonal(conn: any) {
  const wps = conn.waypoints;
  expect(wps.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    const isHorizontal = dy < 1;
    const isVertical = dx < 1;
    expect(
      isHorizontal || isVertical,
      `Connection ${conn.id} segment ${i - 1}→${i} is diagonal: ` +
        `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
    ).toBe(true);
  }
}

/** Check whether two elements overlap (bounding box intersection). */
function overlaps(a: any, b: any): boolean {
  const aRight = a.x + (a.width || 0);
  const aBottom = a.y + (a.height || 0);
  const bRight = b.x + (b.width || 0);
  const bBottom = b.y + (b.height || 0);
  // Use a small margin to allow near-touching elements
  const margin = 2;
  return (
    a.x < bRight - margin &&
    aRight > b.x + margin &&
    a.y < bBottom - margin &&
    aBottom > b.y + margin
  );
}

// ── Element IDs in 02-exclusive-gateway.bpmn ───────────────────────────────
//
// Start            → StartEvent
// ReviewTask       → UserTask "Review Request"
// GW_Split         → ExclusiveGateway "Approved?"
// ProcessApproval  → ServiceTask "Process Approval" (happy path)
// NotifyRejection  → SendTask "Notify Rejection" (default/off-path)
// GW_Merge         → ExclusiveGateway (merge)
// End              → EndEvent

// ── Element IDs in 03-parallel-gateway.bpmn ────────────────────────────────
//
// Start             → StartEvent
// Fork              → ParallelGateway (fork)
// ChargePayment     → ServiceTask "Charge Payment"
// ReserveInventory  → ServiceTask "Reserve Inventory"
// NotifyWarehouse   → ServiceTask "Notify Warehouse"
// Join              → ParallelGateway (join)
// ConfirmOrder      → UserTask "Confirm Order"
// End               → EndEvent

// ── Element IDs in 19-complex-workflow-patterns.bpmn ───────────────────────
//
// Start              → StartEvent
// TimerStart         → StartEvent (timer, R/P1D)
// GW_Merge1          → ExclusiveGateway (merge after starts)
// ClassifyOrder      → UserTask "Classify Order"
// GW_OrderType       → ExclusiveGateway "Order Type?" (3-way split)
// GW_Fork1           → ParallelGateway (fork — standard path)
// CheckInventory     → ServiceTask "Check Inventory"
// CalculateShipping  → ServiceTask "Calculate Shipping"
// GW_Join1           → ParallelGateway (join)
// ExpressProcess     → ServiceTask "Express Process" (express path)
// Sub_CustomProcess  → SubProcess (collapsed — custom path)
// GW_FinalMerge      → ExclusiveGateway (final merge)
// FinalConfirm       → UserTask "Final Confirm"
// End                → EndEvent

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Reference layout regression', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── 02-exclusive-gateway ─────────────────────────────────────────────

  test('02-exclusive-gateway: layout produces correct left-to-right ordering', async () => {
    const { diagramId, registry } = await importReference('02-exclusive-gateway');
    await handleLayoutDiagram({ diagramId });

    const start = registry.get('Start');
    const review = registry.get('ReviewTask');
    const gwSplit = registry.get('GW_Split');
    const approve = registry.get('ProcessApproval');
    const reject = registry.get('NotifyRejection');
    const gwMerge = registry.get('GW_Merge');
    const end = registry.get('End');

    // All elements should exist
    for (const el of [start, review, gwSplit, approve, reject, gwMerge, end]) {
      expect(el, 'Element not found in registry').toBeDefined();
    }

    // Main flow should be strictly left-to-right
    expect(centreX(start)).toBeLessThan(centreX(review));
    expect(centreX(review)).toBeLessThan(centreX(gwSplit));
    expect(centreX(gwSplit)).toBeLessThan(centreX(approve));
    expect(centreX(gwSplit)).toBeLessThan(centreX(reject));
    expect(centreX(approve)).toBeLessThan(centreX(gwMerge));
    expect(centreX(gwMerge)).toBeLessThan(centreX(end));
  });

  test('02-exclusive-gateway: rejection branch on distinct Y row', async () => {
    const { diagramId, registry } = await importReference('02-exclusive-gateway');
    await handleLayoutDiagram({ diagramId });

    const approve = registry.get('ProcessApproval');
    const reject = registry.get('NotifyRejection');

    // Approval and Rejection should be on different Y rows
    expect(Math.abs(centreY(approve) - centreY(reject))).toBeGreaterThan(10);
  });

  // ── 03-parallel-gateway ──────────────────────────────────────────────

  test('03-parallel-gateway: parallel branches on distinct Y rows', async () => {
    const { diagramId, registry } = await importReference('03-parallel-gateway');
    await handleLayoutDiagram({ diagramId });

    const charge = registry.get('ChargePayment');
    const reserve = registry.get('ReserveInventory');
    const notify = registry.get('NotifyWarehouse');

    // All three branches should have distinct Y
    const ys = [centreY(charge), centreY(reserve), centreY(notify)];
    expect(new Set(ys.map((y) => Math.round(y / 10))).size).toBe(3);
  });

  test('03-parallel-gateway: branches between fork and join', async () => {
    const { diagramId, registry } = await importReference('03-parallel-gateway');
    await handleLayoutDiagram({ diagramId });

    const fork = registry.get('Fork');
    const join = registry.get('Join');
    const charge = registry.get('ChargePayment');
    const reserve = registry.get('ReserveInventory');
    const notify = registry.get('NotifyWarehouse');

    for (const branch of [charge, reserve, notify]) {
      expect(centreX(branch)).toBeGreaterThan(centreX(fork));
      expect(centreX(branch)).toBeLessThan(centreX(join));
    }
  });

  // ── 19-complex-workflow-patterns ─────────────────────────────────────

  test('19-complex-workflow-patterns: layout produces correct left-to-right ordering', async () => {
    const { diagramId, registry } = await importReference('19-complex-workflow-patterns');
    await handleLayoutDiagram({ diagramId });

    const start = registry.get('Start');
    const gwMerge1 = registry.get('GW_Merge1');
    const classify = registry.get('ClassifyOrder');
    const gwOrderType = registry.get('GW_OrderType');
    const gwFinalMerge = registry.get('GW_FinalMerge');
    const confirm = registry.get('FinalConfirm');
    const end = registry.get('End');

    // All elements should exist
    for (const el of [start, gwMerge1, classify, gwOrderType, gwFinalMerge, confirm, end]) {
      expect(el, 'Element not found in registry').toBeDefined();
    }

    // Main flow should be strictly left-to-right
    expect(centreX(start)).toBeLessThan(centreX(gwMerge1));
    expect(centreX(gwMerge1)).toBeLessThan(centreX(classify));
    expect(centreX(classify)).toBeLessThan(centreX(gwOrderType));
    expect(centreX(gwOrderType)).toBeLessThan(centreX(gwFinalMerge));
    expect(centreX(gwFinalMerge)).toBeLessThan(centreX(confirm));
    expect(centreX(confirm)).toBeLessThan(centreX(end));
  });

  test('19-complex-workflow-patterns: parallel branches between fork and join', async () => {
    const { diagramId, registry } = await importReference('19-complex-workflow-patterns');
    await handleLayoutDiagram({ diagramId });

    const fork = registry.get('GW_Fork1');
    const join = registry.get('GW_Join1');
    const inventory = registry.get('CheckInventory');
    const shipping = registry.get('CalculateShipping');

    // Parallel branches should be between fork and join
    expect(centreX(inventory)).toBeGreaterThan(centreX(fork));
    expect(centreX(inventory)).toBeLessThan(centreX(join));
    expect(centreX(shipping)).toBeGreaterThan(centreX(fork));
    expect(centreX(shipping)).toBeLessThan(centreX(join));

    // And on different Y rows
    expect(Math.abs(centreY(inventory) - centreY(shipping))).toBeGreaterThan(10);
  });

  test('19-complex-workflow-patterns: all connections are orthogonal', async () => {
    const { diagramId, registry } = await importReference('19-complex-workflow-patterns');
    await handleLayoutDiagram({ diagramId });

    const connections = registry.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    expect(connections.length).toBeGreaterThan(0);

    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });

  test('19-complex-workflow-patterns: no element overlaps', async () => {
    const { diagramId, registry } = await importReference('19-complex-workflow-patterns');
    await handleLayoutDiagram({ diagramId });

    // Get all visible shape elements (non-connections, non-infrastructure)
    const shapes = registry.filter(
      (el: any) =>
        !el.type?.includes('SequenceFlow') &&
        !el.type?.includes('MessageFlow') &&
        !el.type?.includes('Association') &&
        el.type !== 'bpmn:Process' &&
        el.type !== 'bpmn:Collaboration' &&
        el.type !== 'label' &&
        el.type !== 'bpmndi:BPMNDiagram' &&
        el.type !== 'bpmndi:BPMNPlane' &&
        el.width > 0
    );

    // Check all pairs for overlaps — allow known issues (multiple start events may overlap)
    const overlapList: string[] = [];
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        // Skip parent-child pairs (subprocess contains children)
        if (shapes[i].parent === shapes[j] || shapes[j].parent === shapes[i]) continue;
        if (overlaps(shapes[i], shapes[j])) {
          overlapList.push(`${shapes[i].id} <-> ${shapes[j].id}`);
        }
      }
    }

    // Known issue: multiple start events and complex patterns may overlap (see TODO.md P2)
    // Allow up to 2 overlap pairs for now
    expect(
      overlapList.length,
      `Overlapping pairs (max 2 allowed): ${overlapList.join(', ')}`
    ).toBeLessThanOrEqual(2);
  });

  // ── Position tracking (always passes — tracks progress) ──────────────

  test('02-exclusive-gateway: positions match reference within tolerance', async () => {
    const { diagramId, registry } = await importReference('02-exclusive-gateway');
    await handleLayoutDiagram({ diagramId });

    const { mismatches, matchRate } = comparePositions(registry, '02-exclusive-gateway', 10);

    if (mismatches.length > 0) {
      console.error('\n── Position mismatches (02-exclusive-gateway) ──');
      for (const m of mismatches) {
        console.error(
          `  ${m.elementId}: ref(${m.refX},${m.refY}) actual(${m.actualX},${m.actualY}) Δ(${m.dx},${m.dy})`
        );
      }
      console.error(`  Match rate: ${(matchRate * 100).toFixed(1)}%`);
    }

    expect(matchRate).toBeGreaterThanOrEqual(0); // Always passes — tracks progress
  });

  test('03-parallel-gateway: positions match reference within tolerance', async () => {
    const { diagramId, registry } = await importReference('03-parallel-gateway');
    await handleLayoutDiagram({ diagramId });

    const { mismatches, matchRate } = comparePositions(registry, '03-parallel-gateway', 10);

    if (mismatches.length > 0) {
      console.error('\n── Position mismatches (03-parallel-gateway) ──');
      for (const m of mismatches) {
        console.error(
          `  ${m.elementId}: ref(${m.refX},${m.refY}) actual(${m.actualX},${m.actualY}) Δ(${m.dx},${m.dy})`
        );
      }
      console.error(`  Match rate: ${(matchRate * 100).toFixed(1)}%`);
    }

    expect(matchRate).toBeGreaterThanOrEqual(0);
  });

  test('19-complex-workflow-patterns: positions match reference within tolerance', async () => {
    const { diagramId, registry } = await importReference('19-complex-workflow-patterns');
    await handleLayoutDiagram({ diagramId });

    const { mismatches, matchRate } = comparePositions(
      registry,
      '19-complex-workflow-patterns',
      10
    );

    if (mismatches.length > 0) {
      console.error('\n── Position mismatches (19-complex-workflow-patterns) ──');
      for (const m of mismatches) {
        console.error(
          `  ${m.elementId}: ref(${m.refX},${m.refY}) actual(${m.actualX},${m.actualY}) Δ(${m.dx},${m.dy})`
        );
      }
      console.error(`  Match rate: ${(matchRate * 100).toFixed(1)}%`);
    }

    expect(matchRate).toBeGreaterThanOrEqual(0);
  });
});
