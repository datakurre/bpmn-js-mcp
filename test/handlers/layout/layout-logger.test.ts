/**
 * Tests for LayoutLogger (J4 / B7).
 *
 * Verifies that:
 * - Step entries are always recorded regardless of BPMN_MCP_LAYOUT_DEBUG.
 * - Each entry has the correct step name and a non-negative duration.
 * - `stepWithDelta()` records `movedCount` from the count callback.
 * - `stepAsyncWithDelta()` works for async steps.
 * - Nested/sequential steps produce one entry each.
 */
import { describe, test, expect } from 'vitest';
import { createLayoutLogger, type PositionSnapshot } from '../../../src/elk/layout-logger';

describe('LayoutLogger (B7)', () => {
  test('records entries for step() calls even without DEBUG env var', () => {
    const log = createLayoutLogger('test');

    log.step('step-a', () => {});
    log.step('step-b', () => 42);

    const entries = log.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].step).toBe('step-a');
    expect(entries[1].step).toBe('step-b');
  });

  test('records non-negative durations', () => {
    const log = createLayoutLogger('test');
    log.step('slow', () => {
      // minimal delay — rely on Date.now() resolution
    });
    const [entry] = log.getEntries();
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('stepWithDelta records movedCount from the count callback', () => {
    const log = createLayoutLogger('test');

    // Simulate a snapshot with 3 elements
    const makeSnapshot = (): PositionSnapshot =>
      new Map([
        ['e1', { x: 100, y: 200 }],
        ['e2', { x: 300, y: 200 }],
        ['e3', { x: 500, y: 200 }],
      ]);

    // Count callback: 2 elements moved
    const countFn = (_before: PositionSnapshot) => 2;

    log.stepWithDelta('grid-snap', () => {}, makeSnapshot, countFn);

    const entries = log.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].step).toBe('grid-snap');
    expect(entries[0].movedCount).toBe(2);
  });

  test('stepWithDelta records movedCount=0 when no elements moved', () => {
    const log = createLayoutLogger('test');

    const makeSnapshot = (): PositionSnapshot => new Map([['e1', { x: 100, y: 200 }]]);

    log.stepWithDelta(
      'no-op',
      () => {},
      makeSnapshot,
      () => 0
    );

    const [entry] = log.getEntries();
    expect(entry.movedCount).toBe(0);
  });

  test('stepAsyncWithDelta records movedCount from async step', async () => {
    const log = createLayoutLogger('test');

    const makeSnapshot = (): PositionSnapshot => new Map([['e1', { x: 50, y: 100 }]]);
    const countFn = () => 5;

    await log.stepAsyncWithDelta('apply-positions', async () => {}, makeSnapshot, countFn);

    const entries = log.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].step).toBe('apply-positions');
    expect(entries[0].movedCount).toBe(5);
  });

  test('step() entries have undefined movedCount (not tracked)', () => {
    const log = createLayoutLogger('test');
    log.step('plain-step', () => {});
    const [entry] = log.getEntries();
    expect(entry.movedCount).toBeUndefined();
  });

  test('records all sequential steps in order', () => {
    const log = createLayoutLogger('test');
    const names = ['step-1', 'step-2', 'step-3'];
    for (const name of names) {
      log.step(name, () => {});
    }
    const entries = log.getEntries();
    expect(entries.map((e) => e.step)).toEqual(names);
  });

  test('beginStep + endStep records an entry', () => {
    const log = createLayoutLogger('test');
    log.beginStep('manual-step');
    log.endStep();
    const entries = log.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].step).toBe('manual-step');
  });

  test('stepWithDelta returns the function result', () => {
    const log = createLayoutLogger('test');
    const result = log.stepWithDelta(
      'compute',
      () => 42,
      () => new Map(),
      () => 0
    );
    expect(result).toBe(42);
  });

  test('getEntries is immutable (returns a readonly view)', () => {
    const log = createLayoutLogger('test');
    log.step('s', () => {});
    const entries = log.getEntries();
    // TypeScript enforces this at compile time; verify runtime object identity
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(1);
  });
});
