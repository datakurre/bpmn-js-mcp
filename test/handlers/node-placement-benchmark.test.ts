/**
 * Benchmark: ELK node-placement strategies on 07-complex-workflow.bpmn.
 *
 * Compares NETWORK_SIMPLEX, BRANDES_KOEPF, and LINEAR_SEGMENTS to
 * determine which produces the best layout for BPMN diagrams.
 *
 * Metrics per strategy:
 * - Y-variance of main-path elements (lower = better straight-line alignment)
 * - Total diagram width and height
 * - Whether parallel branches (Process Payment, Reserve Inventory) are on distinct Y rows
 * - Whether all main-path flows are orthogonal
 *
 * These are benchmark tests, skipped in CI.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { handleLayoutDiagram } from '../../src/handlers';
import { clearDiagrams, importReference } from '../helpers';
import { ELK_LAYOUT_OPTIONS } from '../../src/elk/constants';

describe.skipIf(!!process.env.CI)('ELK node-placement strategy benchmarks', () => {
  // ── Types ──────────────────────────────────────────────────────────────────

  type Strategy = 'NETWORK_SIMPLEX' | 'BRANDES_KOEPF' | 'LINEAR_SEGMENTS';

  interface StrategyMetrics {
    strategy: Strategy;
    yVariance: number;
    diagramWidth: number;
    diagramHeight: number;
    parallelBranchesDistinct: boolean;
    allMainPathOrthogonal: boolean;
    leftToRightValid: boolean;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Centre-X of an element. */
  function centreX(el: any): number {
    return el.x + (el.width || 0) / 2;
  }

  /** Centre-Y of an element. */
  function centreY(el: any): number {
    return el.y + (el.height || 0) / 2;
  }

  /** Compute the variance of an array of numbers. */
  function variance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  }

  /** Check if all waypoints of a connection form strictly orthogonal segments. */
  function isOrthogonal(conn: any): boolean {
    const wps = conn.waypoints;
    if (!wps || wps.length < 2) return false;
    for (let i = 1; i < wps.length; i++) {
      const dx = Math.abs(wps[i].x - wps[i - 1].x);
      const dy = Math.abs(wps[i].y - wps[i - 1].y);
      const isHorizontal = dy < 1;
      const isVertical = dx < 1;
      if (!isHorizontal && !isVertical) return false;
    }
    return true;
  }

  // ── Element IDs in 07-complex-workflow.bpmn ────────────────────────────────
  //
  // Event_1kc0fqv    → StartEvent "Order Placed"
  // Activity_0glogve → ServiceTask "Validate Order"
  // Gateway_0ircx6m  → ExclusiveGateway "Valid?"
  // Gateway_0g0pyit  → ParallelGateway (fork)
  // Activity_0rnc8vk → ServiceTask "Process Payment"
  // Activity_0mr8w51 → ServiceTask "Reserve Inventory"
  // Gateway_0rzojmn  → ParallelGateway (join)
  // Activity_1kdlney → UserTask "Ship Order"
  // Event_1hm7wwe    → EndEvent "Order Fulfilled"
  // Activity_02pkc1i → SendTask "Send Rejection"
  // Event_01cpts6    → EndEvent "Order Rejected"

  /** Main-path element IDs in left-to-right order. */
  const MAIN_PATH_IDS = [
    'Event_1kc0fqv', // StartEvent "Order Placed"
    'Activity_0glogve', // ServiceTask "Validate Order"
    'Gateway_0ircx6m', // ExclusiveGateway "Valid?"
    'Gateway_0g0pyit', // ParallelGateway (fork)
    'Gateway_0rzojmn', // ParallelGateway (join)
    'Activity_1kdlney', // UserTask "Ship Order"
    'Event_1hm7wwe', // EndEvent "Order Fulfilled"
  ];

  /** Main-path flow IDs for orthogonality checks. */
  const MAIN_PATH_FLOW_IDS = new Set([
    'Flow_0710ei0', // Order Placed → Validate Order
    'Flow_007jsi5', // Validate Order → Valid?
    'Flow_0f3s1zc', // Valid? → fork (Yes)
    'Flow_0mgoijn', // fork → Process Payment
    'Flow_0rpogl4', // fork → Reserve Inventory
    'Flow_033c36g', // Process Payment → join
    'Flow_11j4u79', // Reserve Inventory → join
    'Flow_1gzog11', // join → Ship Order
    'Flow_12mfwdq', // Ship Order → Order Fulfilled
  ]);

  /**
   * Import 07-complex-workflow.bpmn, apply a node-placement strategy, run layout,
   * and collect quality metrics.
   */
  async function runWithStrategy(strategy: Strategy): Promise<StrategyMetrics> {
    const { diagramId, registry } = await importReference('07-complex-workflow');

    // Patch ELK options with the target strategy
    ELK_LAYOUT_OPTIONS['elk.layered.nodePlacement.strategy'] = strategy;

    await handleLayoutDiagram({ diagramId });

    const reg = registry;

    // Collect main-path elements
    const mainPathElements = MAIN_PATH_IDS.map((id) => reg.get(id)).filter(Boolean);

    // Y-variance of main-path centres (lower = better alignment)
    const mainPathYs = mainPathElements.map((el: any) => centreY(el));
    const yVariance = variance(mainPathYs);

    // Diagram bounding box (all visible shapes)
    const shapes = reg.filter(
      (el: any) =>
        !el.type?.includes('SequenceFlow') &&
        !el.type?.includes('MessageFlow') &&
        !el.type?.includes('Association') &&
        el.type !== 'bpmn:Process' &&
        el.type !== 'bpmn:Collaboration' &&
        el.type !== 'label' &&
        el.type !== 'bpmndi:BPMNDiagram' &&
        el.type !== 'bpmndi:BPMNPlane' &&
        (el.width || 0) > 0
    );

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const s of shapes) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      const right = s.x + (s.width || 0);
      const bottom = s.y + (s.height || 0);
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }
    const diagramWidth = maxX - minX;
    const diagramHeight = maxY - minY;

    // Parallel branches on distinct Y rows
    const payment = reg.get('Activity_0rnc8vk');
    const inventory = reg.get('Activity_0mr8w51');
    const parallelBranchesDistinct =
      payment && inventory ? Math.abs(centreY(payment) - centreY(inventory)) > 10 : false;

    // Orthogonality of main-path flows
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    const mainPathConns = connections.filter((c: any) => MAIN_PATH_FLOW_IDS.has(c.id));
    const allMainPathOrthogonal = mainPathConns.every((c: any) => isOrthogonal(c));

    // Left-to-right ordering validation
    let leftToRightValid = true;
    for (let i = 1; i < mainPathElements.length; i++) {
      if (centreX(mainPathElements[i]) <= centreX(mainPathElements[i - 1])) {
        leftToRightValid = false;
        break;
      }
    }

    return {
      strategy,
      yVariance,
      diagramWidth,
      diagramHeight,
      parallelBranchesDistinct,
      allMainPathOrthogonal,
      leftToRightValid,
    };
  }

  // ── Tests ──────────────────────────────────────────────────────────────────

  describe('ELK node-placement strategy benchmark', () => {
    let originalStrategy: string | undefined;

    beforeEach(() => {
      clearDiagrams();
      originalStrategy = ELK_LAYOUT_OPTIONS['elk.layered.nodePlacement.strategy'];
    });

    afterEach(() => {
      // Always restore the original strategy
      if (originalStrategy !== undefined) {
        ELK_LAYOUT_OPTIONS['elk.layered.nodePlacement.strategy'] = originalStrategy;
      } else {
        delete ELK_LAYOUT_OPTIONS['elk.layered.nodePlacement.strategy'];
      }
      clearDiagrams();
    });

    const strategies: Strategy[] = ['NETWORK_SIMPLEX', 'BRANDES_KOEPF', 'LINEAR_SEGMENTS'];

    for (const strategy of strategies) {
      test(`${strategy}: produces valid left-to-right layout`, async () => {
        const metrics = await runWithStrategy(strategy);

        // Log metrics for human review
        console.error(`\n── ${strategy} ──`);
        console.error(`  Y-variance (main path): ${metrics.yVariance.toFixed(2)}`);
        console.error(
          `  Diagram size:           ${metrics.diagramWidth.toFixed(0)} × ${metrics.diagramHeight.toFixed(0)}`
        );
        console.error(`  Parallel branches distinct: ${metrics.parallelBranchesDistinct}`);
        console.error(`  Main-path orthogonal:       ${metrics.allMainPathOrthogonal}`);
        console.error(`  Left-to-right valid:        ${metrics.leftToRightValid}`);

        // All strategies must produce valid left-to-right ordering
        expect(metrics.leftToRightValid).toBe(true);
      });
    }

    test('comparative summary of all strategies', async () => {
      const results: StrategyMetrics[] = [];

      for (const strategy of strategies) {
        clearDiagrams();
        const metrics = await runWithStrategy(strategy);
        results.push(metrics);
      }

      // Print comparison table
      console.error('\n╔══════════════════════════════════════════════════════════════════╗');
      console.error('║          ELK Node-Placement Strategy Benchmark                  ║');
      console.error('╠══════════════════════╦═══════════╦═══════════╦════════╦═════════╣');
      console.error('║ Strategy             ║ Y-Var     ║ Size WxH  ║ Branch ║ Ortho   ║');
      console.error('╠══════════════════════╬═══════════╬═══════════╬════════╬═════════╣');
      for (const m of results) {
        const name = m.strategy.padEnd(20);
        const yVar = m.yVariance.toFixed(1).padStart(7);
        const size = `${m.diagramWidth.toFixed(0)}×${m.diagramHeight.toFixed(0)}`.padStart(9);
        const branch = m.parallelBranchesDistinct ? '  ✓   ' : '  ✗   ';
        const ortho = m.allMainPathOrthogonal ? '  ✓    ' : '  ✗    ';
        console.error(`║ ${name} ║ ${yVar}   ║ ${size} ║${branch}║${ortho}║`);
      }
      console.error('╚══════════════════════╩═══════════╩═══════════╩════════╩═════════╝');

      // Find the best strategy by lowest Y-variance (with left-to-right as a prerequisite)
      const valid = results.filter((r) => r.leftToRightValid);
      expect(valid.length).toBeGreaterThan(0);

      const best = valid.reduce((a, b) => (a.yVariance < b.yVariance ? a : b));
      console.error(
        `\n  Best strategy (lowest Y-variance): ${best.strategy} (${best.yVariance.toFixed(2)})`
      );

      // All strategies should produce valid layouts
      for (const m of results) {
        expect(m.leftToRightValid, `${m.strategy} failed left-to-right ordering`).toBe(true);
      }
    });
  });
}); // end describe.skipIf
