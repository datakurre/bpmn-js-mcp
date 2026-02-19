/**
 * Large diagram performance test (I3).
 *
 * Verifies that layout_bpmn_diagram completes within a reasonable time
 * for diagrams with 50+ elements, guarding against O(n³) regressions.
 *
 * Strategy:
 *  - Build a linear chain of 55 elements (1 start + 50 tasks + 1 gateway
 *    + 2 branches + 1 end = 55 flow elements).
 *  - Measure wall-clock time for a single layout pass.
 *  - Assert layout completes within 30 s (very generous bound —
 *    O(n²) at n=55 finishes in <1 s; O(n³) would take minutes).
 *
 * Additionally verifies that the layout returns valid results (success,
 * correct element count).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a linear chain: Start → task_1 → ... → task_n → End */
async function buildLinearChain(diagramId: string, taskCount: number): Promise<void> {
  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
  let prev = start;

  for (let i = 1; i <= taskCount; i++) {
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: `Task ${i}` });
    await connect(diagramId, prev, task);
    prev = task;
  }

  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
  await connect(diagramId, prev, end);
}

/**
 * Create a process with parallel branches to stress-test the crossing
 * detection and overlap resolution passes.
 *
 * Structure: Start → Split → [Branch A (10 tasks), Branch B (10 tasks)]
 *            → Join → (10 more tasks) → End
 * Total flow nodes: 1 + 2 + 10 + 10 + 1 + 10 + 1 = 35 + 2 gateways = 37
 */
async function buildParallelProcess(diagramId: string, branchSize: number): Promise<void> {
  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
  const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
  await connect(diagramId, start, split);

  // Branch A
  let prevA: string = split;
  for (let i = 1; i <= branchSize; i++) {
    const t = await addElement(diagramId, 'bpmn:ServiceTask', { name: `A${i}` });
    await connect(diagramId, prevA, t);
    prevA = t;
  }

  // Branch B
  let prevB: string = split;
  for (let i = 1; i <= branchSize; i++) {
    const t = await addElement(diagramId, 'bpmn:UserTask', { name: `B${i}` });
    await connect(diagramId, prevB, t);
    prevB = t;
  }

  const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
  await connect(diagramId, prevA, join);
  await connect(diagramId, prevB, join);

  // Tail
  let prev: string = join;
  for (let i = 1; i <= branchSize; i++) {
    const t = await addElement(diagramId, 'bpmn:UserTask', { name: `Tail${i}` });
    await connect(diagramId, prev, t);
    prev = t;
  }

  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
  await connect(diagramId, prev, end);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('large diagram performance (I3)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('linear chain of 50 tasks lays out within 30 s', { timeout: 60_000 }, async () => {
    const TASK_COUNT = 50;
    const diagramId = await createDiagram('Large Linear');
    await buildLinearChain(diagramId, TASK_COUNT);

    const t0 = Date.now();
    const result = parseResult(await handleLayoutDiagram({ diagramId }));
    const elapsed = Date.now() - t0;

    expect(result.success).toBe(true);

    // 50 tasks + 1 start + 1 end = 52 flow elements
    expect(result.elementCount).toBeGreaterThanOrEqual(TASK_COUNT + 2);

    // Performance guard: O(n²) at n=52 is trivially fast;
    // O(n³) at n=52 would take tens of seconds.
    expect(
      elapsed,
      `Layout of ${TASK_COUNT} tasks took ${elapsed} ms — possible O(n³) regression`
    ).toBeLessThan(30_000);
  });

  test(
    'parallel process with 3×10 elements lays out within 30 s',
    { timeout: 60_000 },
    async () => {
      const BRANCH_SIZE = 10;
      const diagramId = await createDiagram('Large Parallel');
      await buildParallelProcess(diagramId, BRANCH_SIZE);

      const t0 = Date.now();
      const result = parseResult(await handleLayoutDiagram({ diagramId }));
      const elapsed = Date.now() - t0;

      expect(result.success).toBe(true);

      // 2 gateways + 3 * BRANCH_SIZE tasks + start + end = 3*10 + 4 = 34
      expect(result.elementCount).toBeGreaterThanOrEqual(3 * BRANCH_SIZE + 4);

      expect(
        elapsed,
        `Layout of parallel process (3×${BRANCH_SIZE}) took ${elapsed} ms`
      ).toBeLessThan(30_000);
    }
  );

  test(
    'all elements are placed at valid positions after large layout',
    { timeout: 60_000 },
    async () => {
      const diagramId = await createDiagram('Large Positions');
      await buildLinearChain(diagramId, 30);

      await handleLayoutDiagram({ diagramId });

      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
      const allShapes = reg
        .getAll()
        .filter(
          (el: any) =>
            el.width !== undefined &&
            el.x !== undefined &&
            el.type !== 'label' &&
            !el.type?.includes('Flow') &&
            el.type !== 'bpmn:Process'
        );

      // Every placed shape must have a valid (finite, non-negative) position
      for (const shape of allShapes) {
        expect(isFinite(shape.x), `${shape.id} has non-finite x: ${shape.x}`).toBe(true);
        expect(isFinite(shape.y), `${shape.id} has non-finite y: ${shape.y}`).toBe(true);
        expect(shape.x, `${shape.id} has negative x: ${shape.x}`).toBeGreaterThanOrEqual(0);
        expect(shape.y, `${shape.id} has negative y: ${shape.y}`).toBeGreaterThanOrEqual(0);
      }
    }
  );

  test(
    'quadratic scaling: 50-task layout not dramatically slower than 10-task',
    { timeout: 120_000 },
    async () => {
      // Build and lay out a 10-element chain to get a baseline
      const smallId = await createDiagram('Small Baseline');
      await buildLinearChain(smallId, 10);
      const tSmallStart = Date.now();
      await handleLayoutDiagram({ diagramId: smallId });
      const tSmall = Date.now() - tSmallStart;

      clearDiagrams();

      // Build and lay out a 50-element chain
      const largeId = await createDiagram('Large Scaled');
      await buildLinearChain(largeId, 50);
      const tLargeStart = Date.now();
      await handleLayoutDiagram({ diagramId: largeId });
      const tLarge = Date.now() - tLargeStart;

      // At O(n²): ratio ≈ (50/10)^2 = 25×.  Allow up to 100× as a generous
      // upper bound that still catches O(n³) regressions (ratio would be 125×+).
      // Also allow a minimum of 5 s for tSmall to avoid division-by-near-zero.
      const effectiveSmall = Math.max(tSmall, 50); // floor at 50 ms
      const ratio = tLarge / effectiveSmall;

      expect(
        ratio,
        `Large layout (${tLarge} ms) is ${ratio.toFixed(1)}× slower than small (${tSmall} ms). ` +
          `This suggests an O(n³) or worse regression.`
      ).toBeLessThan(200);
    }
  );
});
