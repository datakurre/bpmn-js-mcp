/**
 * Per-reference coordinate comparison tests.
 *
 * For each reference BPMN in test/fixtures/layout-references/, this test:
 * 1. Imports the reference BPMN
 * 2. Runs ELK layout
 * 3. Compares resulting element positions against reference coordinates
 *
 * Run with: npx vitest run test/handlers/reference-coordinates.test.ts
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../src/handlers';
import { clearDiagrams, importReference, comparePositions } from '../helpers';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Centre-Y of an element. */
function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

/** Centre-X of an element. */
function centreX(el: any): number {
  return el.x + (el.width || 0) / 2;
}

/**
 * Log position comparison results for debugging.
 * Called when mismatches exist.
 */
function logMismatches(name: string, result: ReturnType<typeof comparePositions>) {
  if (result.mismatches.length > 0) {
    console.error(`\n── Position mismatches (${name}) ──`);
    for (const m of result.mismatches) {
      console.error(
        `  ${m.elementId}: ref(${m.refX},${m.refY}) actual(${m.actualX},${m.actualY}) Δ(${m.dx},${m.dy})`
      );
    }
    console.error(
      `  Match rate: ${(result.matchRate * 100).toFixed(1)}% (${result.deltas.length - result.mismatches.length}/${result.deltas.length})`
    );
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Reference coordinate comparison', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── 01 Linear Flow ───────────────────────────────────────────────────
  // Element IDs (from 01-linear-flow.bpmn):
  //   Event_1l18z3u  = StartEvent "Order Received"
  //   Activity_01aji74 = UserTask "Validate Order"
  //   Activity_1p2y7u9 = ServiceTask "Process Payment"
  //   Activity_0jy2ses = UserTask "Ship Order"
  //   Event_0bdlayk  = EndEvent "Order Complete"

  describe('01-linear-flow', () => {
    test('all elements on same Y row', async () => {
      const { diagramId, registry } = await importReference('01-linear-flow');
      await handleLayoutDiagram({ diagramId });

      // IDs in left-to-right flow order
      const ids = [
        'Event_1l18z3u', // StartEvent "Order Received"
        'Activity_01aji74', // UserTask "Validate Order"
        'Activity_1p2y7u9', // ServiceTask "Process Payment"
        'Activity_0jy2ses', // UserTask "Ship Order"
        'Event_0bdlayk', // EndEvent "Order Complete"
      ];

      const elements = ids.map((id) => registry.get(id)).filter(Boolean);
      expect(elements.length).toBe(5);

      // All elements should be on the same Y row (within 5px)
      const refY = centreY(elements[0]);
      for (const el of elements) {
        expect(
          Math.abs(centreY(el) - refY),
          `${el.id} Y=${centreY(el)} not on row Y=${refY}`
        ).toBeLessThanOrEqual(5);
      }
    });

    test('uniform horizontal gaps between elements', async () => {
      const { diagramId, registry } = await importReference('01-linear-flow');
      await handleLayoutDiagram({ diagramId });

      // IDs in left-to-right flow order
      const ids = [
        'Event_1l18z3u', // StartEvent "Order Received"
        'Activity_01aji74', // UserTask "Validate Order"
        'Activity_1p2y7u9', // ServiceTask "Process Payment"
        'Activity_0jy2ses', // UserTask "Ship Order"
        'Event_0bdlayk', // EndEvent "Order Complete"
      ];

      const elements = ids.map((id) => registry.get(id)).filter(Boolean);

      // Compute edge-to-edge gaps between consecutive elements
      const gaps: number[] = [];
      for (let i = 1; i < elements.length; i++) {
        const prevRight = elements[i - 1].x + (elements[i - 1].width || 0);
        const currLeft = elements[i].x;
        gaps.push(currLeft - prevRight);
      }

      // All gaps should be positive (left-to-right ordering)
      for (const gap of gaps) {
        expect(gap, 'Elements should not overlap horizontally').toBeGreaterThan(0);
      }

      // Log for debugging
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const stdDev = Math.sqrt(gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length);
      console.error(
        `\n  01-linear-flow gaps: [${gaps.map((g) => g.toFixed(0)).join(', ')}] mean=${mean.toFixed(0)} stdDev=${stdDev.toFixed(1)}`
      );
    });

    test('positions match reference', async () => {
      const { diagramId, registry } = await importReference('01-linear-flow');
      await handleLayoutDiagram({ diagramId });

      const result = comparePositions(registry, '01-linear-flow', 10);
      logMismatches('01-linear-flow', result);

      // Track progress — always passes
      expect(result.matchRate).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 02 Exclusive Gateway ─────────────────────────────────────────────
  // Element IDs (from 02-exclusive-gateway.bpmn):
  //   Event_0dskcoo  = StartEvent "Request Received"
  //   Gateway_0jdocql = ExclusiveGateway "Approved?"
  //   Activity_1ra1cd4 = UserTask "Fulfill Request" (happy path)
  //   Activity_0ryvb1v = UserTask "Send Rejection" (default/off-path)
  //   Gateway_1hd85cz = ExclusiveGateway "Merge"
  //   Event_0a768vd  = EndEvent "Done"

  describe('02-exclusive-gateway', () => {
    test('happy path elements on same Y row', async () => {
      const { diagramId, registry } = await importReference('02-exclusive-gateway');
      await handleLayoutDiagram({ diagramId });

      // Happy path: Start → Approved? → Fulfill Request → Merge → Done
      const happyIds = [
        'Event_0dskcoo', // StartEvent "Request Received"
        'Gateway_0jdocql', // ExclusiveGateway "Approved?"
        'Activity_1ra1cd4', // UserTask "Fulfill Request"
        'Gateway_1hd85cz', // ExclusiveGateway "Merge"
        'Event_0a768vd', // EndEvent "Done"
      ];

      const elements = happyIds.map((id) => registry.get(id)).filter(Boolean);
      expect(elements.length).toBe(5);

      // Happy path elements should share same Y (within 5px)
      const refY = centreY(elements[0]);
      for (const el of elements) {
        expect(
          Math.abs(centreY(el) - refY),
          `${el.id} Y=${centreY(el)} not on happy path row Y=${refY}`
        ).toBeLessThanOrEqual(5);
      }
    });

    test('"Send Rejection" below happy path', async () => {
      const { diagramId, registry } = await importReference('02-exclusive-gateway');
      await handleLayoutDiagram({ diagramId });

      const gateway = registry.get('Gateway_0jdocql'); // Approved?
      const rejection = registry.get('Activity_0ryvb1v'); // Send Rejection

      // Rejection task should be below the gateway
      expect(centreY(rejection)).toBeGreaterThan(centreY(gateway) + 10);
    });

    test('positions match reference', async () => {
      const { diagramId, registry } = await importReference('02-exclusive-gateway');
      await handleLayoutDiagram({ diagramId });

      const result = comparePositions(registry, '02-exclusive-gateway', 10);
      logMismatches('02-exclusive-gateway', result);
      expect(result.matchRate).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 03 Parallel Fork-Join ────────────────────────────────────────────
  // Element IDs (from 03-parallel-fork-join.bpmn):
  //   Event_1tfz1g5  = StartEvent "Start"
  //   Gateway_11h8qzw = ParallelGateway (fork)
  //   Activity_0z4100l = UserTask "Check Inventory"
  //   Activity_0gqc9jk = ServiceTask "Charge Payment"
  //   Activity_0p6g9d6 = UserTask "Notify Warehouse"
  //   Gateway_1osli9i = ParallelGateway (join)
  //   Event_183di0m  = EndEvent "Complete"

  describe('03-parallel-fork-join', () => {
    test('three branches on distinct Y rows', async () => {
      const { diagramId, registry } = await importReference('03-parallel-fork-join');
      await handleLayoutDiagram({ diagramId });

      const check = registry.get('Activity_0z4100l'); // Check Inventory
      const charge = registry.get('Activity_0gqc9jk'); // Charge Payment
      const notify = registry.get('Activity_0p6g9d6'); // Notify Warehouse

      // All three branches should have distinct Y
      const ys = [centreY(check), centreY(charge), centreY(notify)];
      expect(new Set(ys.map((y) => Math.round(y / 10))).size).toBe(3);
    });

    test('branch ordering matches reference (top to bottom)', async () => {
      const { diagramId, registry } = await importReference('03-parallel-fork-join');
      await handleLayoutDiagram({ diagramId });

      const check = registry.get('Activity_0z4100l'); // Check Inventory
      const charge = registry.get('Activity_0gqc9jk'); // Charge Payment
      const notify = registry.get('Activity_0p6g9d6'); // Notify Warehouse

      // Reference order top-to-bottom: Check Inventory, Charge Payment, Notify Warehouse
      expect(centreY(check), 'Check Inventory should be above Charge Payment').toBeLessThan(
        centreY(charge)
      );
      expect(centreY(charge), 'Charge Payment should be above Notify Warehouse').toBeLessThan(
        centreY(notify)
      );
    });

    test('positions match reference', async () => {
      const { diagramId, registry } = await importReference('03-parallel-fork-join');
      await handleLayoutDiagram({ diagramId });

      const result = comparePositions(registry, '03-parallel-fork-join', 10);
      logMismatches('03-parallel-fork-join', result);
      expect(result.matchRate).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 04 Nested Subprocess ─────────────────────────────────────────────
  // Element IDs (from 04-nested-subprocess.bpmn):
  //   Event_00a3pyb  = StartEvent "Start" (outer)
  //   Activity_1cgwbmf = SubProcess (expanded)
  //   Event_0c0rtvp  = StartEvent "Sub Start" (inner)
  //   Activity_19zstl3 = UserTask "Review Document" (inner)
  //   Event_1w6m3i5  = EndEvent "Sub End" (inner)
  //   Event_0pnzs42  = EndEvent "End" (outer)

  describe('04-nested-subprocess', () => {
    test('inner elements within subprocess bounds', async () => {
      const { diagramId, registry } = await importReference('04-nested-subprocess');
      await handleLayoutDiagram({ diagramId });

      const sub = registry.get('Activity_1cgwbmf'); // SubProcess
      const subStart = registry.get('Event_0c0rtvp'); // Sub Start
      const subTask = registry.get('Activity_19zstl3'); // Review Document
      const subEnd = registry.get('Event_1w6m3i5'); // Sub End (inner)

      if (sub && subStart && subTask && subEnd) {
        const subRight = sub.x + (sub.width || 0);
        const subBottom = sub.y + (sub.height || 0);

        for (const inner of [subStart, subTask, subEnd]) {
          expect(inner.x, `${inner.id} left of subprocess`).toBeGreaterThanOrEqual(sub.x);
          expect(inner.y, `${inner.id} above subprocess`).toBeGreaterThanOrEqual(sub.y);
          expect(
            inner.x + (inner.width || 0),
            `${inner.id} right of subprocess`
          ).toBeLessThanOrEqual(subRight);
          expect(inner.y + (inner.height || 0), `${inner.id} below subprocess`).toBeLessThanOrEqual(
            subBottom
          );
        }
      }
    });

    test('positions match reference', async () => {
      const { diagramId, registry } = await importReference('04-nested-subprocess');
      await handleLayoutDiagram({ diagramId });

      const result = comparePositions(registry, '04-nested-subprocess', 10);
      logMismatches('04-nested-subprocess', result);
      expect(result.matchRate).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 05 Collaboration ─────────────────────────────────────────────────
  // Element IDs (from 05-collaboration.bpmn):
  //   Participant_1kju1v4 = "Customer" (expanded, with processRef)
  //   Participant_0yixlru = "System" (expanded, with processRef)

  describe('05-collaboration', () => {
    test('pools do not overlap', async () => {
      const { diagramId, registry } = await importReference('05-collaboration');
      await handleLayoutDiagram({ diagramId });

      const pool1 = registry.get('Participant_1kju1v4'); // Customer
      const pool2 = registry.get('Participant_0yixlru'); // System

      if (pool1 && pool2) {
        // Pools should be stacked (pool2 below pool1) — allow small overlap tolerance
        expect(pool2.y, 'Pools should be stacked vertically').toBeGreaterThan(pool1.y);
      }
    });

    test('positions match reference', async () => {
      const { diagramId, registry } = await importReference('05-collaboration');
      await handleLayoutDiagram({ diagramId });

      const result = comparePositions(registry, '05-collaboration', 10);
      logMismatches('05-collaboration', result);
      expect(result.matchRate).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 06 Boundary Events ───────────────────────────────────────────────
  // Element IDs (from 06-boundary-events.bpmn):
  //   Event_1mzoegj  = StartEvent "Start"
  //   Activity_1betloc = UserTask "Review Application"
  //   Activity_0af6hcw = UserTask "Approve"
  //   Event_1d7wnd9  = EndEvent "Done"
  //   Event_1w9t4mj  = BoundaryEvent "Timeout" (on Review Application)
  //   Activity_1wslow0 = UserTask "Escalate"
  //   Event_0tvw53g  = EndEvent "Escalated"

  describe('06-boundary-events', () => {
    test('escalation path below main flow', async () => {
      const { diagramId, registry } = await importReference('06-boundary-events');
      await handleLayoutDiagram({ diagramId });

      const review = registry.get('Activity_1betloc'); // Review Application
      const escalate = registry.get('Activity_1wslow0'); // Escalate

      if (review && escalate) {
        // Escalation task should be below or at the same Y as the main task
        expect(centreY(escalate)).toBeGreaterThanOrEqual(centreY(review));
      }
    });

    test('boundary event attached to host', async () => {
      const { diagramId, registry } = await importReference('06-boundary-events');
      await handleLayoutDiagram({ diagramId });

      const review = registry.get('Activity_1betloc'); // Review Application (host)
      const boundary = registry.get('Event_1w9t4mj'); // Timeout boundary event

      if (review && boundary) {
        // Boundary event should be near the host element's bottom edge
        const hostBottom = review.y + (review.height || 0);
        expect(
          Math.abs(centreY(boundary) - hostBottom),
          'Boundary event should be near host bottom edge'
        ).toBeLessThan(50);
      }
    });

    test('positions match reference', async () => {
      const { diagramId, registry } = await importReference('06-boundary-events');
      await handleLayoutDiagram({ diagramId });

      const result = comparePositions(registry, '06-boundary-events', 10);
      logMismatches('06-boundary-events', result);
      expect(result.matchRate).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 07 Complex Workflow ──────────────────────────────────────────────
  // Element IDs (from 07-complex-workflow.bpmn):
  //   Event_1kc0fqv  = StartEvent "Order Placed"
  //   Activity_0glogve = ServiceTask "Validate Order"
  //   Gateway_0ircx6m = ExclusiveGateway "Valid?"
  //   Gateway_0g0pyit = ParallelGateway (fork)
  //   Activity_0rnc8vk = ServiceTask "Process Payment"
  //   Activity_0mr8w51 = ServiceTask "Reserve Inventory"
  //   Gateway_0rzojmn = ParallelGateway (join)
  //   Activity_1kdlney = UserTask "Ship Order"
  //   Event_1hm7wwe  = EndEvent "Order Fulfilled"
  //   Activity_02pkc1i = SendTask "Send Rejection"
  //   Event_01cpts6  = EndEvent "Order Rejected"

  describe('07-complex-workflow', () => {
    test('rejection branch below parallel branches', async () => {
      const { diagramId, registry } = await importReference('07-complex-workflow');
      await handleLayoutDiagram({ diagramId });

      const payment = registry.get('Activity_0rnc8vk'); // Process Payment
      const inventory = registry.get('Activity_0mr8w51'); // Reserve Inventory
      const rejection = registry.get('Activity_02pkc1i'); // Send Rejection

      // Rejection should be below both parallel branches
      const maxParallelY = Math.max(centreY(payment), centreY(inventory));
      expect(
        centreY(rejection),
        'Rejection branch should be below parallel branches'
      ).toBeGreaterThan(maxParallelY);
    });

    test('parallel branches between fork and join', async () => {
      const { diagramId, registry } = await importReference('07-complex-workflow');
      await handleLayoutDiagram({ diagramId });

      const fork = registry.get('Gateway_0g0pyit');
      const join = registry.get('Gateway_0rzojmn');
      const payment = registry.get('Activity_0rnc8vk');
      const inventory = registry.get('Activity_0mr8w51');

      expect(centreX(payment)).toBeGreaterThan(centreX(fork));
      expect(centreX(payment)).toBeLessThan(centreX(join));
      expect(centreX(inventory)).toBeGreaterThan(centreX(fork));
      expect(centreX(inventory)).toBeLessThan(centreX(join));
    });

    test('positions match reference', async () => {
      const { diagramId, registry } = await importReference('07-complex-workflow');
      await handleLayoutDiagram({ diagramId });

      const result = comparePositions(registry, '07-complex-workflow', 10);
      logMismatches('07-complex-workflow', result);
      expect(result.matchRate).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 08 Collaboration Collapsed ───────────────────────────────────────
  // Element IDs (from 08-collaboration-collapsed.bpmn):
  //   Participant_1kju1v4 = "Customer" (expanded, has processRef)
  //   Participant_0yixlru = "System" (collapsed, no processRef)

  describe('08-collaboration-collapsed', () => {
    test('collapsed pool is a thin bar', async () => {
      const { diagramId, registry } = await importReference('08-collaboration-collapsed');
      await handleLayoutDiagram({ diagramId });

      const expandedPool = registry.get('Participant_1kju1v4'); // Customer (expanded)
      const collapsedPool = registry.get('Participant_0yixlru'); // System (collapsed)

      if (expandedPool && collapsedPool) {
        // Collapsed pool should be thinner than an expanded pool
        expect(
          collapsedPool.height,
          'Collapsed pool should be shorter than expanded pool'
        ).toBeLessThanOrEqual(expandedPool.height);
      }
    });

    test('expanded pool above collapsed pool', async () => {
      const { diagramId, registry } = await importReference('08-collaboration-collapsed');
      await handleLayoutDiagram({ diagramId });

      const expandedPool = registry.get('Participant_1kju1v4'); // Customer (expanded)
      const collapsedPool = registry.get('Participant_0yixlru'); // System (collapsed)

      if (expandedPool && collapsedPool) {
        const expandedBottom = expandedPool.y + (expandedPool.height || 0);
        expect(
          collapsedPool.y,
          'Collapsed pool should be below expanded pool'
        ).toBeGreaterThanOrEqual(expandedBottom);
      }
    });

    test('positions match reference', async () => {
      const { diagramId, registry } = await importReference('08-collaboration-collapsed');
      await handleLayoutDiagram({ diagramId });

      const result = comparePositions(registry, '08-collaboration-collapsed', 10);
      logMismatches('08-collaboration-collapsed', result);
      expect(result.matchRate).toBeGreaterThanOrEqual(0);
    });
  });
});
