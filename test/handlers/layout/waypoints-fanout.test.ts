/**
 * Tests for gateway fan-out waypoint routing threshold.
 *
 * bpmn-js's preferred layout applies a V→H (3-waypoint) fan-out path when
 * a gateway branch target is "significantly" offset from the gateway centre.
 * The threshold for "significant" should be `sourceHalfHeight + 20` so that
 * near-horizontal connections (offset ≤ 45px for a 50px gateway) stay as
 * straight 2-point or L-shaped 4-point paths rather than the V→H variant.
 *
 * See TODO: "Improve gateway fan-out waypoint docking".
 */

import { describe, test, expect } from 'vitest';
import { resetStaleWaypoints } from '../../../src/rebuild/waypoints';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock connection for a gateway-to-target flow.
 *
 * @param targetOffsetY  Y-offset of target center from gateway center (positive = below).
 */
function makeGatewayConn(targetOffsetY: number): {
  source: { type: string; x: number; y: number; width: number; height: number };
  target: { x: number; y: number; width: number; height: number };
  waypoints: Array<{ x: number; y: number }>;
} {
  // 50×50 gateway placed at (100, 175), center at (125, 200)
  const source = {
    type: 'bpmn:ExclusiveGateway',
    x: 100,
    y: 175,
    width: 50,
    height: 50,
  };
  // sourceMidY = 200, sourceHalfHeight = 25

  const targetMidY = 200 + targetOffsetY;
  const targetHeight = 80;
  const target = {
    x: 250,
    y: targetMidY - targetHeight / 2,
    width: 100,
    height: targetHeight,
  };

  // Waypoints where first point is at source center X — this triggers stale
  // detection check 4 (wrong-exit direction) so the connection is always
  // considered stale, making the only variable the fan-out vs L-shape choice.
  return {
    source,
    target,
    waypoints: [
      { x: 125, y: 200 }, // source center X = 100 + 50/2 = 125 (triggers stale)
      { x: 350, y: targetMidY },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Gateway fan-out threshold
// ═══════════════════════════════════════════════════════════════════════════

describe('gateway fan-out waypoint threshold', () => {
  /**
   * A branch offset of 30px is greater than the old threshold
   * (sourceHalfHeight = 25px) but below the new threshold
   * (sourceHalfHeight + 20 = 45px).
   *
   * Old behaviour: applies 3-point V→H fan-out (30 > 25).
   * New behaviour: falls through to L-shape detection → 4-point path.
   */
  test('30px offset does NOT trigger V→H fan-out (below sourceHalfHeight + 20 threshold)', () => {
    const conn = makeGatewayConn(30) as any;
    resetStaleWaypoints(conn);

    // Old code: 30 > sourceHalfHeight=25 → V→H applied → 3 waypoints.
    // New code: 30 ≤ sourceHalfHeight+20=45 → no fan-out → stale detection →
    //           L-shape (4 waypoints) or 2-point straight path.
    expect(conn.waypoints.length).not.toBe(3);
  });

  /**
   * A branch offset of 50px exceeds the new threshold (45px), so the V→H
   * fan-out should still be applied.
   */
  test('50px offset DOES trigger V→H fan-out (above sourceHalfHeight + 20 threshold)', () => {
    const conn = makeGatewayConn(50) as any;
    resetStaleWaypoints(conn);

    // 50 > sourceHalfHeight+20=45 → fan-out applies → 3-point V→H path
    expect(conn.waypoints.length).toBe(3);
  });

  /**
   * An offset exactly at the new threshold (45px) should NOT trigger fan-out.
   * The condition is `<= threshold` so threshold is the boundary of the
   * "no fan-out" zone.
   */
  test('45px offset (exactly at new threshold) does NOT trigger V→H fan-out', () => {
    const conn = makeGatewayConn(45) as any;
    resetStaleWaypoints(conn);

    // 45 ≤ sourceHalfHeight+20=45 → no fan-out
    expect(conn.waypoints.length).not.toBe(3);
  });

  /**
   * An offset of 26px (> old threshold 25, ≤ new threshold 45) should no
   * longer produce a V→H path after the fix.
   */
  test('26px offset (just above old threshold) no longer triggers V→H fan-out', () => {
    const conn = makeGatewayConn(26) as any;
    resetStaleWaypoints(conn);

    // Old code: 26 > 25 → V→H (3 points)
    // New code: 26 ≤ 45 → no fan-out
    expect(conn.waypoints.length).not.toBe(3);
  });
});
