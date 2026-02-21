/**
 * Edge route simplification passes.
 *
 * Simplifies gateway branch routes to clean Z-shapes and removes
 * redundant collinear waypoints from all connections.
 */

import { isConnection } from './helpers';
import type { ElementRegistry, Modeling } from '../bpmn-types';
import { cloneWaypoints } from '../geometry';
import { buildZShapeRoute } from './edge-routing-helpers';
import {
  DIFFERENT_ROW_THRESHOLD,
  MICRO_BEND_TOLERANCE,
  SHORT_SEGMENT_THRESHOLD,
} from './constants';

/** Maximum backward distance (px) in a jog before it's considered intentional. */
const BACKWARD_JOG_THRESHOLD = 20;

// ── Gateway branch route simplification ────────────────────────────────────

/**
 * Simplify gateway branch connections to clean Z-shaped routes.
 *
 * For connections where the source is a split gateway and the target is
 * on a different row, replaces multi-bend ELK routes with a 4-waypoint
 * Z-shape: horizontal from gateway right edge → vertical segment →
 * horizontal to target left edge.
 *
 * Only applies when:
 * - The route has 5+ waypoints (indicating unnecessary bends)
 * - The gateway has at most 3 outgoing flows (binary/ternary split pattern)
 * - The target is to the right of the source
 *
 * Gateways with 4+ branches are left to ELK routing + channel routing
 * which handles them better to avoid crossing flows.
 */
export function simplifyGatewayBranchRoutes(
  elementRegistry: ElementRegistry,
  modeling: Modeling
): void {
  const BPMN_SEQUENCE_FLOW = 'bpmn:SequenceFlow';
  // Build a count of outgoing/incoming flows per gateway
  const allConns = elementRegistry.filter(
    (el) => el.type === BPMN_SEQUENCE_FLOW && !!el.source && !!el.target
  );
  const gwOutCount = new Map<string, number>();
  const gwInCount = new Map<string, number>();
  for (const conn of allConns) {
    if (conn.source?.type?.includes('Gateway')) {
      gwOutCount.set(conn.source.id, (gwOutCount.get(conn.source.id) || 0) + 1);
    }
    if (conn.target?.type?.includes('Gateway')) {
      gwInCount.set(conn.target.id, (gwInCount.get(conn.target.id) || 0) + 1);
    }
  }

  const connections = elementRegistry.filter(
    (el) =>
      el.type === BPMN_SEQUENCE_FLOW &&
      !!el.source &&
      !!el.target &&
      !!el.waypoints &&
      el.waypoints.length >= 5
  );

  for (const conn of connections) {
    const src = conn.source!;
    const tgt = conn.target!;

    // Only process split-gateway → branch-target connections
    if (!src.type?.includes('Gateway')) continue;

    // Only apply to binary/ternary splits (2–3 outgoing) — larger fan-outs
    // are handled by ELK + channel routing to avoid crossings
    if ((gwOutCount.get(src.id) || 0) > 3) continue;

    // Only process if the target is on a different Y (different row)
    const srcCy = src.y + (src.height || 0) / 2;
    const tgtCy = tgt.y + (tgt.height || 0) / 2;
    if (Math.abs(srcCy - tgtCy) < DIFFERENT_ROW_THRESHOLD) continue;

    // Only process if target is to the right
    const srcRight = src.x + (src.width || 0);
    const tgtLeft = tgt.x;
    if (tgtLeft <= srcRight) continue;

    // Build Z-shaped route
    modeling.updateWaypoints(conn, buildZShapeRoute(srcRight, srcCy, tgtLeft, tgtCy));
  }

  // Also simplify join-gateway incoming connections (branch-target → join)
  // but only for binary/ternary joins (2–3 incoming branch flows)
  const joinConnections = elementRegistry.filter(
    (el) =>
      el.type === BPMN_SEQUENCE_FLOW &&
      !!el.source &&
      !!el.target &&
      !!el.waypoints &&
      el.waypoints.length >= 5 &&
      !!el.target.type?.includes('Gateway')
  );

  for (const conn of joinConnections) {
    const src = conn.source!;
    const tgt = conn.target!;

    // Only apply to binary/ternary joins
    if ((gwInCount.get(tgt.id) || 0) > 3) continue;

    // Only process if source is on a different Y (different row)
    const srcCy = src.y + (src.height || 0) / 2;
    const tgtCy = tgt.y + (tgt.height || 0) / 2;
    if (Math.abs(srcCy - tgtCy) < DIFFERENT_ROW_THRESHOLD) continue;

    const srcRight = src.x + (src.width || 0);
    const tgtLeft = tgt.x;
    if (tgtLeft <= srcRight) continue;

    modeling.updateWaypoints(conn, buildZShapeRoute(srcRight, srcCy, tgtLeft, tgtCy));
  }
}

// ── Collinear waypoint simplification ──────────────────────────────────────

/**
 * Remove redundant collinear waypoints from all connections.
 *
 * After ELK routing and post-processing (channel routing, orthogonal snap),
 * connections may have consecutive waypoints that lie on the same horizontal
 * or vertical line.  The middle point of such a collinear triple is redundant
 * and can be removed to produce cleaner routes with fewer bend points.
 *
 * Example:  (100,200) → (200,200) → (300,200)  →  simplifies to (100,200) → (300,200)
 */
export function simplifyCollinearWaypoints(
  elementRegistry: ElementRegistry,
  modeling: Modeling
): void {
  const connections = elementRegistry.filter(
    (el) => isConnection(el.type) && !!el.waypoints && el.waypoints.length >= 3
  );

  for (const conn of connections) {
    const wps = cloneWaypoints(conn.waypoints!);

    const simplified = removeCollinearPoints(wps);

    if (simplified.length < wps.length && simplified.length >= 2) {
      modeling.updateWaypoints(conn, simplified);
    }
  }
}

/**
 * Remove collinear middle points from a waypoint array.
 *
 * Three consecutive points are collinear when the middle point lies on the
 * same horizontal line (all share Y within tolerance) or the same vertical
 * line (all share X within tolerance).  Uses a tolerance of 1px to handle
 * sub-pixel rounding from ELK.
 */
function removeCollinearPoints(
  wps: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  if (wps.length < 3) return wps;

  const TOLERANCE = 1;
  const result: Array<{ x: number; y: number }> = [wps[0]];

  for (let i = 1; i < wps.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = wps[i];
    const next = wps[i + 1];

    // Check if prev, curr, next are on the same horizontal line
    const sameY = Math.abs(prev.y - curr.y) <= TOLERANCE && Math.abs(curr.y - next.y) <= TOLERANCE;
    // Check if prev, curr, next are on the same vertical line
    const sameX = Math.abs(prev.x - curr.x) <= TOLERANCE && Math.abs(curr.x - next.x) <= TOLERANCE;

    if (!sameY && !sameX) {
      // Not collinear — keep the middle point
      result.push(curr);
    }
    // else: collinear — skip the middle point
  }

  result.push(wps[wps.length - 1]);
  return result;
}

// ── Micro-bend removal ─────────────────────────────────────────────────────

/**
 * Remove micro-bends from all connections in the diagram.
 *
 * A micro-bend is a small deviation from a straight horizontal or vertical
 * path that creates a visible wiggle.  Two patterns are detected:
 *
 * **Near-collinear triples:** Three consecutive waypoints that are nearly
 * on the same horizontal line (all Y within `MICRO_BEND_TOLERANCE`) or the
 * same vertical line (all X within tolerance).  The middle point is removed.
 *
 * **Short orthogonal segments (staircases):** An H-V-H or V-H-V pattern
 * where the middle segment is shorter than `SHORT_SEGMENT_THRESHOLD`.  The
 * short segment is flattened by snapping both surrounding bend points to
 * the same axis.
 *
 * Boundary event connections are skipped because their routing is
 * intentionally non-standard (L-shaped exits from host element edges).
 *
 * Should run after `simplifyCollinearWaypoints` as a second, more
 * aggressive straightening pass.
 */
export function removeMicroBends(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const BPMN_BOUNDARY_EVENT = 'bpmn:BoundaryEvent';

  // Pass 0: remove backward jogs from ALL connections (including boundary-event sources).
  // A backward jog is a small monotonicity reversal on a near-horizontal or near-vertical
  // run (e.g. x goes 1087→1184→1174: forward 97px, then back 10px).
  const allConnections = elementRegistry.filter(
    (el) => isConnection(el.type) && !!el.waypoints && el.waypoints.length >= 3
  );
  for (const conn of allConnections) {
    const wps = cloneWaypoints(conn.waypoints!);
    const fixed = removeBackwardJogs(wps);
    if (fixed.length < wps.length && fixed.length >= 2) {
      modeling.updateWaypoints(conn, fixed);
    }
  }

  const connections = elementRegistry.filter(
    (el) =>
      isConnection(el.type) &&
      !!el.waypoints &&
      el.waypoints.length >= 3 &&
      el.source?.type !== BPMN_BOUNDARY_EVENT
  );

  for (const conn of connections) {
    const wps = cloneWaypoints(conn.waypoints!);

    // Pass 1: remove near-collinear triples (micro-wiggle)
    let simplified = removeNearCollinearPoints(wps);

    // Pass 2: merge short orthogonal segments (staircase)
    simplified = mergeShortSegments(simplified);

    if (simplified.length < wps.length && simplified.length >= 2) {
      modeling.updateWaypoints(conn, simplified);
    }
  }
}

/**
 * Remove near-collinear middle points from a waypoint array.
 *
 * Like `removeCollinearPoints` but with a larger tolerance to catch
 * micro-bends: small deviations (e.g. a 2–3px Y-shift) that create
 * a visible wiggle in what should be a straight horizontal or vertical
 * segment.
 */
function removeNearCollinearPoints(
  wps: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  if (wps.length < 3) return wps;

  const result: Array<{ x: number; y: number }> = [wps[0]];

  for (let i = 1; i < wps.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = wps[i];
    const next = wps[i + 1];

    // Near-horizontal: all Y values within tolerance
    const nearHorizontal =
      Math.abs(prev.y - curr.y) <= MICRO_BEND_TOLERANCE &&
      Math.abs(curr.y - next.y) <= MICRO_BEND_TOLERANCE &&
      Math.abs(prev.y - next.y) <= MICRO_BEND_TOLERANCE;

    // Near-vertical: all X values within tolerance
    const nearVertical =
      Math.abs(prev.x - curr.x) <= MICRO_BEND_TOLERANCE &&
      Math.abs(curr.x - next.x) <= MICRO_BEND_TOLERANCE &&
      Math.abs(prev.x - next.x) <= MICRO_BEND_TOLERANCE;

    if (!nearHorizontal && !nearVertical) {
      result.push(curr);
    }
    // else: near-collinear — skip the middle point (micro-bend removed)
  }

  result.push(wps[wps.length - 1]);
  return result;
}

/**
 * Remove backward jogs from a waypoint array.
 *
 * A backward jog is three consecutive waypoints where the path reverses
 * direction by less than `BACKWARD_JOG_THRESHOLD` pixels on a
 * near-horizontal or near-vertical run.
 *
 * Example: (1087,348) → (1184,348) → (1174,348)
 * The path goes right 97px then reverses 10px left — the middle point
 * (1184,348) is removed, yielding the direct segment (1087,348)→(1174,348).
 *
 * This catches monotonicity violations that `removeNearCollinearPoints`
 * misses for connections that are skipped due to the boundary-event filter.
 */
function removeBackwardJogs(wps: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (wps.length < 3) return wps;

  const result: Array<{ x: number; y: number }> = [wps[0]];

  for (let i = 1; i < wps.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = wps[i];
    const next = wps[i + 1];

    // Near-horizontal run: all Y within tolerance
    const nearHorizontal =
      Math.abs(prev.y - curr.y) <= MICRO_BEND_TOLERANCE &&
      Math.abs(curr.y - next.y) <= MICRO_BEND_TOLERANCE;

    if (nearHorizontal) {
      const xForward = curr.x - prev.x;
      const xBack = next.x - curr.x;
      // Backward jog: direction reverses and the reversal is smaller than threshold
      if (
        Math.sign(xForward) !== 0 &&
        Math.sign(xForward) !== Math.sign(xBack) &&
        Math.abs(xBack) < BACKWARD_JOG_THRESHOLD
      ) {
        continue; // skip the backward-jog intermediate point
      }
    }

    // Near-vertical run: all X within tolerance
    const nearVertical =
      Math.abs(prev.x - curr.x) <= MICRO_BEND_TOLERANCE &&
      Math.abs(curr.x - next.x) <= MICRO_BEND_TOLERANCE;

    if (nearVertical) {
      const yForward = curr.y - prev.y;
      const yBack = next.y - curr.y;
      // Backward jog: direction reverses and the reversal is smaller than threshold
      if (
        Math.sign(yForward) !== 0 &&
        Math.sign(yForward) !== Math.sign(yBack) &&
        Math.abs(yBack) < BACKWARD_JOG_THRESHOLD
      ) {
        continue; // skip the backward-jog intermediate point
      }
    }

    result.push(curr);
  }

  result.push(wps[wps.length - 1]);
  return result;
}

/**
 * Merge short orthogonal segments (staircases) in a waypoint array.
 *
 * Detects H-V-H patterns where the vertical segment is very short, or
 * V-H-V patterns where the horizontal segment is very short.  Flattens
 * the staircase by snapping both surrounding bend points to the same
 * axis value (using the average of the two Y or X values).
 *
 * Example (H-V-H staircase with short vertical):
 *   (100,200) → (200,200) → (200,203) → (300,203)
 *   becomes: (100,200) → (300,200)  [or similar, after collinear cleanup]
 */
function mergeShortSegments(wps: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (wps.length < 4) return wps;

  // Work on a copy so we can mutate in-place
  const result = cloneWaypoints(wps);
  let changed = false;

  for (let i = 0; i < result.length - 3; i++) {
    const a = result[i];
    const b = result[i + 1];
    const c = result[i + 2];
    const d = result[i + 3];

    // H-V-H: horizontal → short vertical → horizontal
    const abHorizontal = Math.abs(a.y - b.y) <= 1;
    const bcVertical = Math.abs(b.x - c.x) <= 1;
    const cdHorizontal = Math.abs(c.y - d.y) <= 1;

    if (abHorizontal && bcVertical && cdHorizontal) {
      const vLen = Math.abs(b.y - c.y);
      if (vLen > 0 && vLen <= SHORT_SEGMENT_THRESHOLD) {
        // Snap both bend points to the average Y
        const avgY = Math.round((b.y + c.y) / 2);
        b.y = avgY;
        c.y = avgY;
        changed = true;
        continue;
      }
    }

    // V-H-V: vertical → short horizontal → vertical
    const abVertical = Math.abs(a.x - b.x) <= 1;
    const bcHorizontal = Math.abs(b.y - c.y) <= 1;
    const cdVertical = Math.abs(c.x - d.x) <= 1;

    if (abVertical && bcHorizontal && cdVertical) {
      const hLen = Math.abs(b.x - c.x);
      if (hLen > 0 && hLen <= SHORT_SEGMENT_THRESHOLD) {
        // Snap both bend points to the average X
        const avgX = Math.round((b.x + c.x) / 2);
        b.x = avgX;
        c.x = avgX;
        changed = true;
      }
    }
  }

  if (!changed) return wps;

  // After merging short segments, the b and c points may now be identical
  // or collinear with their neighbors — run a final collinear cleanup.
  return removeCollinearPoints(result);
}
