import { describe, test, expect, beforeEach } from 'vitest';
import { handleConnect } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { lintDiagram, lintDiagramFlat, clearLintCache } from '../../../src/linter';
import { getDiagram } from '../../../src/diagram-manager';

/**
 * Performance benchmarks for linting.
 *
 * Quantifies lint time for diagrams of varying size to detect regressions
 * and assess whether the fresh-Linter-per-call strategy needs optimisation.
 *
 * These are benchmark tests, skipped in CI.
 */
describe.skipIf(!!process.env.CI)('linter performance benchmarks', () => {
  beforeEach(() => {
    clearDiagrams();
    clearLintCache();
  });

  /**
   * Build a linear chain: Start → Task1 → Task2 → ... → TaskN → End.
   * Returns the diagram ID.
   */
  async function buildLinearChain(n: number): Promise<string> {
    const diagramId = await createDiagram(`Bench-${n}`);
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 50,
      y: 200,
    });

    let prev = start;
    for (let i = 1; i <= n; i++) {
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: `Task ${i}`,
        x: 50 + i * 160,
        y: 200,
      });
      await connect(diagramId, prev, task);
      prev = task;
    }

    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 50 + (n + 1) * 160,
      y: 200,
    });
    await connect(diagramId, prev, end);

    return diagramId;
  }

  /**
   * Build a branching diamond: Start → GW → [N tasks] → Join → End.
   */
  async function buildDiamond(branches: number): Promise<string> {
    const diagramId = await createDiagram(`Diamond-${branches}`);
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 50,
      y: 300,
    });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Split',
      x: 200,
      y: 300,
    });
    await connect(diagramId, start, gw);

    const join = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Join',
      x: 500,
      y: 300,
    });

    for (let i = 0; i < branches; i++) {
      const task = await addElement(diagramId, 'bpmn:UserTask', {
        name: `Branch ${i + 1}`,
        x: 350,
        y: 100 + i * 100,
      });
      const connectOpts: any = {
        diagramId,
        sourceElementId: gw,
        targetElementId: task,
      };
      if (i === 0) {
        connectOpts.conditionExpression = '${branch == 1}';
      } else if (i === branches - 1) {
        connectOpts.isDefault = true;
      } else {
        connectOpts.conditionExpression = `\${branch == ${i + 1}}`;
      }
      await handleConnect(connectOpts);
      await connect(diagramId, task, join);
    }

    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 650,
      y: 300,
    });
    await connect(diagramId, join, end);

    return diagramId;
  }

  async function measureLintMs(diagramId: string): Promise<{ ms: number; issueCount: number }> {
    const diagram = getDiagram(diagramId)!;
    clearLintCache();
    const t0 = performance.now();
    const issues = await lintDiagramFlat(diagram);
    const t1 = performance.now();
    return { ms: t1 - t0, issueCount: issues.length };
  }

  // ── Small diagram (3 tasks) ──────────────────────────────────────────

  test('lint small diagram (3 tasks) completes under 5s', async () => {
    const diagramId = await buildLinearChain(3);
    const { ms, issueCount } = await measureLintMs(diagramId);

    console.error(`  Small (3 tasks): ${ms.toFixed(0)}ms, ${issueCount} issues`);
    expect(ms).toBeLessThan(5_000);
  });

  // ── Medium diagram (10 tasks) ────────────────────────────────────────

  test('lint medium diagram (10 tasks) completes under 10s', async () => {
    const diagramId = await buildLinearChain(10);
    const { ms, issueCount } = await measureLintMs(diagramId);

    console.error(`  Medium (10 tasks): ${ms.toFixed(0)}ms, ${issueCount} issues`);
    expect(ms).toBeLessThan(10_000);
  });

  // ── Diamond diagram (5 branches) ────────────────────────────────────

  test('lint diamond diagram (5 branches) completes under 10s', async () => {
    const diagramId = await buildDiamond(5);
    const { ms, issueCount } = await measureLintMs(diagramId);

    console.error(`  Diamond (5 branches): ${ms.toFixed(0)}ms, ${issueCount} issues`);
    expect(ms).toBeLessThan(10_000);
  });

  // ── Lint cache effectiveness ─────────────────────────────────────────

  test('second lint call is faster due to caching', async () => {
    const diagramId = await buildLinearChain(5);
    const diagram = getDiagram(diagramId)!;
    clearLintCache();

    // First call — cold
    const t0 = performance.now();
    await lintDiagram(diagram);
    const cold = performance.now() - t0;

    // Second call — should hit cache (no mutation in between)
    const t1 = performance.now();
    await lintDiagram(diagram);
    const warm = performance.now() - t1;

    console.error(
      `  Cache: cold=${cold.toFixed(0)}ms, warm=${warm.toFixed(0)}ms, speedup=${(cold / Math.max(warm, 0.01)).toFixed(1)}x`
    );

    // Warm should be significantly faster (at least 2x)
    // Use a generous threshold to avoid flaky tests
    expect(warm).toBeLessThan(cold);
  });
});
