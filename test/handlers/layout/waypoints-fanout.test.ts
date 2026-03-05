/**
 * Tests for gateway fan-out waypoint routing threshold.
 *
 * bpmn-js's preferred layout applies a V→H (3-waypoint) fan-out path when
 * a gateway branch target is "significantly" offset from the gateway centre.
 * The threshold is `sourceHalfHeight` (25px for a 50px gateway) so that any
 * Y-offset beyond the gateway half-height triggers a clean V→H path instead
 * of a diagonal L-shape.
 *
 * Previously the threshold was `sourceHalfHeight + 20 = 45px` which caused
 * offsets in the 26–45px range to skip fan-out and produce diagonal segments.
 * The threshold was lowered to `sourceHalfHeight` to fix this (see TODO).
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
// Gateway fan-out threshold (threshold = sourceHalfHeight = 25px)
// ═══════════════════════════════════════════════════════════════════════════

describe('gateway fan-out waypoint threshold', () => {
  /**
   * A branch offset of 30px exceeds sourceHalfHeight (25px), so the V→H
   * fan-out should be applied — producing a 3-point path.
   *
   * Previously (threshold = 45) this was incorrectly skipped, causing
   * diagonal L-shapes on common "success straight / failure drop" patterns.
   */
  test('30px offset DOES trigger V→H fan-out (above sourceHalfHeight threshold)', () => {
    const conn = makeGatewayConn(30) as any;
    resetStaleWaypoints(conn);

    // 30 > sourceHalfHeight=25 → fan-out applies → 3-point V→H path
    expect(conn.waypoints.length).toBe(3);
  });

  /**
   * A branch offset of 50px exceeds the threshold (25px), so the V→H
   * fan-out should still be applied.
   */
  test('50px offset DOES trigger V→H fan-out (well above threshold)', () => {
    const conn = makeGatewayConn(50) as any;
    resetStaleWaypoints(conn);

    // 50 > sourceHalfHeight=25 → fan-out applies → 3-point V→H path
    expect(conn.waypoints.length).toBe(3);
  });

  /**
   * An offset exactly at the threshold (25px) should NOT trigger fan-out.
   * The condition is `<= sourceHalfHeight` so 25 is the boundary.
   */
  test('25px offset (exactly at threshold) does NOT trigger V→H fan-out', () => {
    const conn = makeGatewayConn(25) as any;
    resetStaleWaypoints(conn);

    // 25 ≤ sourceHalfHeight=25 → no fan-out → falls through to L-shape
    expect(conn.waypoints.length).not.toBe(3);
  });

  /**
   * An offset of 26px (just above the threshold) should trigger fan-out.
   */
  test('26px offset (just above threshold) triggers V→H fan-out', () => {
    const conn = makeGatewayConn(26) as any;
    resetStaleWaypoints(conn);

    // 26 > sourceHalfHeight=25 → fan-out applies → 3-point V→H path
    expect(conn.waypoints.length).toBe(3);
  });
});
