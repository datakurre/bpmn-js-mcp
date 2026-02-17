/**
 * Benchmark: ELK node-placement strategies on complex workflow diagrams.
 *
 * Compares NETWORK_SIMPLEX, BRANDES_KOEPF, and LINEAR_SEGMENTS to
 * determine which produces the best layout for BPMN diagrams.
 *
 * Metrics per strategy:
 * - Y-variance of main-path elements (lower = better straight-line alignment)
 * - Total diagram width and height
 * - Whether all flows are orthogonal
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
    allOrthogonal: boolean;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

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

  // ── Test reference diagram ─────────────────────────────────────────────────
  // Use 07-complex-workflow as it has multiple gateways and branches

  const REFERENCE_DIAGRAM = '07-complex-workflow';

  /**
   * Import reference diagram, apply a node-placement strategy,
   * run layout, and collect quality metrics.
   */
  async function runWithStrategy(strategy: Strategy): Promise<StrategyMetrics> {
    const { diagramId, registry } = await importReference(REFERENCE_DIAGRAM);

    // Patch ELK options with the target strategy
    ELK_LAYOUT_OPTIONS['elk.layered.nodePlacement.strategy'] = strategy;

    await handleLayoutDiagram({ diagramId });

    const reg = registry;

    // Collect all tasks and events for Y-variance calculation
    const mainElements = reg
      .filter(
        (el: any) =>
          el.type?.includes('Task') || el.type?.includes('Event') || el.type?.includes('Gateway')
      )
      .filter((el: any) => el.type !== 'bpmn:BoundaryEvent');

    // Y-variance of element centres
    const ys = mainElements.map((el: any) => centreY(el));
    const yVar = variance(ys);

    // Diagram bounds
    const allShapes = reg.filter(
      (el: any) => el.width !== undefined && el.height !== undefined && !el.type?.includes('Flow')
    );
    let maxX = 0;
    let maxY = 0;
    for (const s of allShapes) {
      const right = s.x + (s.width || 0);
      const bottom = s.y + (s.height || 0);
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }

    // Check orthogonality of all sequence flows
    const flows = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    const allOrthogonal = flows.every(isOrthogonal);

    return {
      strategy,
      yVariance: yVar,
      diagramWidth: maxX,
      diagramHeight: maxY,
      allOrthogonal,
    };
  }

  // ── Tests ──────────────────────────────────────────────────────────────────

  const STRATEGIES: Strategy[] = ['NETWORK_SIMPLEX', 'BRANDES_KOEPF', 'LINEAR_SEGMENTS'];
  const results: StrategyMetrics[] = [];

  beforeEach(() => {
    clearDiagrams();
  });

  afterEach(() => {
    clearDiagrams();
    // Restore default strategy
    ELK_LAYOUT_OPTIONS['elk.layered.nodePlacement.strategy'] = 'NETWORK_SIMPLEX';
  });

  for (const strategy of STRATEGIES) {
    test(`${strategy}: produces valid left-to-right layout`, async () => {
      const metrics = await runWithStrategy(strategy);
      results.push(metrics);

      // Basic structural assertions
      expect(metrics.diagramWidth).toBeGreaterThan(0);
      expect(metrics.diagramHeight).toBeGreaterThan(0);
      expect(metrics.allOrthogonal).toBe(true);
    });
  }

  test('comparative summary of all strategies', async () => {
    // Run all strategies fresh for comparison
    const compareResults: StrategyMetrics[] = [];
    for (const strategy of STRATEGIES) {
      clearDiagrams();
      const metrics = await runWithStrategy(strategy);
      compareResults.push(metrics);
    }

    // Print comparison table
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════════╗');
    console.error('║          ELK Node-Placement Strategy Benchmark                  ║');
    console.error('╠══════════════════════╦═══════════╦═══════════╦════════╦═════════╣');
    console.error('║ Strategy             ║ Y-Var     ║ Size WxH  ║ Branch ║ Ortho   ║');
    console.error('╠══════════════════════╬═══════════╬═══════════╬════════╬═════════╣');
    for (const m of compareResults) {
      const stratPad = m.strategy.padEnd(20);
      const yVarStr = m.yVariance.toFixed(1).padStart(7);
      const sizeStr = `${m.diagramWidth}×${m.diagramHeight}`.padStart(9);
      const orthoStr = m.allOrthogonal ? '✓' : '✗';
      console.error(
        `║ ${stratPad} ║ ${yVarStr}   ║ ${sizeStr} ║  ${orthoStr}   ║  ${orthoStr}    ║`
      );
    }
    console.error('╚══════════════════════╩═══════════╩═══════════╩════════╩═════════╝');

    // Report best strategy
    const best = compareResults.reduce((a, b) => (a.yVariance < b.yVariance ? a : b));
    console.error(
      `\n  Best strategy (lowest Y-variance): ${best.strategy} (${best.yVariance.toFixed(2)})`
    );

    // At least one strategy should produce orthogonal routes
    const anyOrthogonal = compareResults.some((m) => m.allOrthogonal);
    expect(anyOrthogonal).toBe(true);
  });
});
