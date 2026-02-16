/**
 * Benchmark: ELK node-placement strategies on 19-complex-workflow-patterns.bpmn.
 *
 * Compares NETWORK_SIMPLEX, BRANDES_KOEPF, and LINEAR_SEGMENTS to
 * determine which produces the best layout for BPMN diagrams.
 *
 * Metrics per strategy:
 * - Y-variance of main-path elements (lower = better straight-line alignment)
 * - Total diagram width and height
 * - Whether parallel branches (Check Inventory, Calculate Shipping) are on distinct Y rows
 * - Whether all main-path flows are orthogonal
 *
 * These are benchmark tests, skipped in CI.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { clearDiagrams, importReference } from '../../helpers';
import { ELK_LAYOUT_OPTIONS } from '../../../src/elk/constants';

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

  // ── Element IDs in 19-complex-workflow-patterns.bpmn ───────────────────────
  //
  // Start              → StartEvent
  // TimerStart         → StartEvent (timer, R/P1D)
  // GW_Merge1          → ExclusiveGateway (merge after starts)
  // ClassifyOrder      → UserTask "Classify Order"
  // GW_OrderType       → ExclusiveGateway "Order Type?"
  // GW_Fork1           → ParallelGateway (fork — standard path)
  // CheckInventory     → ServiceTask "Check Inventory"
  // CalculateShipping  → ServiceTask "Calculate Shipping"
  // GW_Join1           → ParallelGateway (join)
  // ExpressProcess     → ServiceTask "Express Process"
  // Sub_CustomProcess  → SubProcess (collapsed)
  // GW_FinalMerge      → ExclusiveGateway (final merge)
  // FinalConfirm       → UserTask "Final Confirm"
  // End                → EndEvent

  /** Main-path element IDs in left-to-right order. */
  const MAIN_PATH_IDS = [
    'Start', // StartEvent
    'GW_Merge1', // ExclusiveGateway (merge)
    'ClassifyOrder', // UserTask "Classify Order"
    'GW_OrderType', // ExclusiveGateway "Order Type?"
    'GW_FinalMerge', // ExclusiveGateway (final merge)
    'FinalConfirm', // UserTask "Final Confirm"
    'End', // EndEvent
  ];

  /** Main-path flow IDs for orthogonality checks. */
  const MAIN_PATH_FLOW_IDS = new Set([
    'Flow1', // Start → GW_Merge1
    'FlowTimer', // TimerStart → GW_Merge1
    'Flow2', // GW_Merge1 → ClassifyOrder
    'Flow3', // ClassifyOrder → GW_OrderType
    'FlowStandard', // GW_OrderType → GW_Fork1
    'FlowA', // GW_Fork1 → CheckInventory
    'FlowB', // GW_Fork1 → CalculateShipping
    'FlowA2', // CheckInventory → GW_Join1
    'FlowB2', // CalculateShipping → GW_Join1
    'FlowJoined', // GW_Join1 → GW_FinalMerge
    'Flow4', // GW_FinalMerge → FinalConfirm
    'Flow5', // FinalConfirm → End
  ]);

  /**
   * Import 19-complex-workflow-patterns.bpmn, apply a node-placement strategy,
   * run layout, and collect quality metrics.
   */
  async function runWithStrategy(strategy: Strategy): Promise<StrategyMetrics> {
    const { diagramId, registry } = await importReference('19-complex-workflow-patterns');

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
    const inventory = reg.get('CheckInventory');
    const shipping = reg.get('CalculateShipping');
    const parallelBranchesDistinct =
      inventory && shipping ? Math.abs(centreY(inventory) - centreY(shipping)) > 10 : false;

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
