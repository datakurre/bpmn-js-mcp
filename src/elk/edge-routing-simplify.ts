/**
 * Edge route simplification passes.
 *
 * Simplifies gateway branch routes to clean Z-shapes and removes
 * redundant collinear waypoints from all connections.
 */

import { isConnection } from './helpers';
import { buildZShapeRoute } from './edge-routing-helpers';

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
 * - The gateway has at most 2 outgoing flows (binary split pattern)
 * - The target is to the right of the source
 *
 * Gateways with 3+ branches are left to ELK routing + channel routing
 * which handles them better to avoid crossing flows.
 */
export function simplifyGatewayBranchRoutes(elementRegistry: any, modeling: any): void {
  const BPMN_SEQUENCE_FLOW = 'bpmn:SequenceFlow';
  // Build a count of outgoing/incoming flows per gateway
  const allConns = elementRegistry.filter(
    (el: any) => el.type === BPMN_SEQUENCE_FLOW && el.source && el.target
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
    (el: any) =>
      el.type === BPMN_SEQUENCE_FLOW &&
      el.source &&
      el.target &&
      el.waypoints &&
      el.waypoints.length >= 5
  );

  for (const conn of connections) {
    const src = conn.source;
    const tgt = conn.target;

    // Only process split-gateway → branch-target connections
    if (!src.type?.includes('Gateway')) continue;

    // Only apply to binary splits (2 outgoing) — larger fan-outs
    // are handled by ELK + channel routing to avoid crossings
    if ((gwOutCount.get(src.id) || 0) > 2) continue;

    // Only process if the target is on a different Y (different row)
    const srcCy = src.y + (src.height || 0) / 2;
    const tgtCy = tgt.y + (tgt.height || 0) / 2;
    if (Math.abs(srcCy - tgtCy) < 10) continue;

    // Only process if target is to the right
    const srcRight = src.x + (src.width || 0);
    const tgtLeft = tgt.x;
    if (tgtLeft <= srcRight) continue;

    // Build Z-shaped route
    modeling.updateWaypoints(conn, buildZShapeRoute(srcRight, srcCy, tgtLeft, tgtCy));
  }

  // Also simplify join-gateway incoming connections (branch-target → join)
  // but only for binary joins (2 incoming branch flows)
  const joinConnections = elementRegistry.filter(
    (el: any) =>
      el.type === BPMN_SEQUENCE_FLOW &&
      el.source &&
      el.target &&
      el.waypoints &&
      el.waypoints.length >= 5 &&
      el.target.type?.includes('Gateway')
  );

  for (const conn of joinConnections) {
    const src = conn.source;
    const tgt = conn.target;

    // Only apply to binary joins
    if ((gwInCount.get(tgt.id) || 0) > 2) continue;

    // Only process if source is on a different Y (different row)
    const srcCy = src.y + (src.height || 0) / 2;
    const tgtCy = tgt.y + (tgt.height || 0) / 2;
    if (Math.abs(srcCy - tgtCy) < 10) continue;

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
export function simplifyCollinearWaypoints(elementRegistry: any, modeling: any): void {
  const connections = elementRegistry.filter(
    (el: any) => isConnection(el.type) && el.waypoints && el.waypoints.length >= 3
  );

  for (const conn of connections) {
    const wps: Array<{ x: number; y: number }> = conn.waypoints.map((wp: any) => ({
      x: wp.x,
      y: wp.y,
    }));

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
