/**
 * Edge endpoint repair and centre-snap passes.
 *
 * Fixes disconnected edge endpoints after grid snap and snaps endpoints
 * to element centre lines.  These are "fixup" passes that repair stale
 * waypoints without changing the overall route topology.
 *
 * Extracted from edge-routing-fix.ts to separate endpoint fixing from
 * route rebuilding/optimization.
 */

import { isConnection } from './helpers';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { deduplicateWaypoints, buildZShapeRoute } from './edge-routing-helpers';
import {
  DISCONNECT_THRESHOLD,
  CENTRE_SNAP_TOLERANCE,
  DIFFERENT_ROW_MIN_Y,
  SAME_ROW_Y_TOLERANCE,
} from './constants';

// ── Shared geometry helpers ─────────────────────────────────────────────────

/** Get the centre point of an element. */
function elementCentre(el: BpmnElement): { x: number; y: number } {
  return {
    x: el.x + (el.width || 0) / 2,
    y: el.y + (el.height || 0) / 2,
  };
}

/** Get the nearest attachment point on an element's boundary for a given external point. */
function nearestBorderPoint(
  el: BpmnElement,
  point: { x: number; y: number }
): { x: number; y: number } {
  const cx = el.x + (el.width || 0) / 2;
  const cy = el.y + (el.height || 0) / 2;
  const hw = (el.width || 0) / 2;
  const hh = (el.height || 0) / 2;

  // Clamp the point to the element's boundary rectangle
  const clampedX = Math.max(el.x, Math.min(el.x + (el.width || 0), point.x));
  const clampedY = Math.max(el.y, Math.min(el.y + (el.height || 0), point.y));

  // If point is inside the element, project to nearest border
  if (
    point.x >= el.x &&
    point.x <= el.x + (el.width || 0) &&
    point.y >= el.y &&
    point.y <= el.y + (el.height || 0)
  ) {
    const dx = point.x - cx;
    const dy = point.y - cy;
    // Project along the dominant axis
    if (Math.abs(dx / hw) >= Math.abs(dy / hh)) {
      return { x: dx > 0 ? el.x + (el.width || 0) : el.x, y: point.y };
    } else {
      return { x: point.x, y: dy > 0 ? el.y + (el.height || 0) : el.y };
    }
  }

  return { x: clampedX, y: clampedY };
}

/** Euclidean distance between two points. */
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ── Disconnected edge repair ────────────────────────────────────────────────

/**
 * Repair disconnected edge endpoints after gridSnap.
 *
 * After gridSnap moves elements, ELK-computed edge routes may no longer
 * connect to their source/target elements.  This pass checks each
 * connection's first and last waypoints and snaps them to the element
 * boundary if they've drifted.
 *
 * For straight horizontal flows (same-Y source and target), rebuilds as
 * a simple 2-point connection.  For L-shaped and Z-shaped routes,
 * adjusts only the disconnected endpoint(s) and maintains orthogonality.
 */
export function fixDisconnectedEdges(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const connections = elementRegistry.filter(
    (el) =>
      isConnection(el.type) &&
      !!el.source &&
      !!el.target &&
      !!el.waypoints &&
      el.waypoints.length >= 2
  );

  for (const conn of connections) {
    const src = conn.source!;
    const tgt = conn.target!;
    const wps: Array<{ x: number; y: number }> = conn.waypoints!.map((wp: any) => ({
      x: wp.x,
      y: wp.y,
    }));

    const srcCentre = elementCentre(src);
    const tgtCentre = elementCentre(tgt);
    const first = wps[0];
    const last = wps[wps.length - 1];

    // Check if source endpoint is near the source element
    const srcBorder = nearestBorderPoint(src, first);
    const srcDist = dist(first, srcBorder);

    // Check if target endpoint is near the target element
    const tgtBorder = nearestBorderPoint(tgt, last);
    const tgtDist = dist(last, tgtBorder);

    if (srcDist <= DISCONNECT_THRESHOLD && tgtDist <= DISCONNECT_THRESHOLD) {
      continue; // Both endpoints are close enough — no fix needed
    }

    // For same-row connections (source and target on roughly the same Y),
    // rebuild as a simple 2-point horizontal flow
    if (Math.abs(srcCentre.y - tgtCentre.y) < SAME_ROW_Y_TOLERANCE) {
      const y = Math.round(srcCentre.y);
      const srcRight = src.x + (src.width || 0);
      const tgtLeft = tgt.x;

      // Straight horizontal: source right edge → target left edge
      if (srcRight < tgtLeft) {
        modeling.updateWaypoints(conn, [
          { x: Math.round(srcRight), y },
          { x: Math.round(tgtLeft), y },
        ]);
        continue;
      }
    }

    // For different-row connections (e.g. cross-lane flows after lane
    // repositioning), rebuild as a Z-shape when at least one endpoint is
    // disconnected and the target is to the right of the source.
    // After lane repositioning, ELK's pre-computed routes become stale:
    // the source endpoint may drift while the target stays connected
    // (or vice versa).  A 2-point vertical line between different-row
    // elements is always wrong when the target is to the right.
    const srcRight = src.x + (src.width || 0);
    const tgtLeft = tgt.x;
    if (
      Math.abs(srcCentre.y - tgtCentre.y) >= DIFFERENT_ROW_MIN_Y &&
      tgtLeft > srcRight &&
      (srcDist > DISCONNECT_THRESHOLD || tgtDist > DISCONNECT_THRESHOLD)
    ) {
      modeling.updateWaypoints(conn, buildZShapeRoute(srcRight, srcCentre.y, tgtLeft, tgtCentre.y));
      continue;
    }

    // For more complex routes, adjust the disconnected endpoints
    let changed = false;

    if (srcDist > DISCONNECT_THRESHOLD) {
      // Move first waypoint to source border
      const newFirst = nearestBorderPoint(src, wps.length > 1 ? wps[1] : tgtCentre);
      wps[0] = { x: Math.round(newFirst.x), y: Math.round(newFirst.y) };
      // Keep orthogonality: snap second waypoint to match axis
      if (wps.length > 1) {
        if (Math.abs(wps[0].x - wps[1].x) < Math.abs(wps[0].y - wps[1].y)) {
          wps[1] = { x: wps[0].x, y: wps[1].y }; // vertical segment
        } else {
          wps[1] = { x: wps[1].x, y: wps[0].y }; // horizontal segment
        }
      }
      changed = true;
    }

    if (tgtDist > DISCONNECT_THRESHOLD) {
      // Move last waypoint to target border
      const newLast = nearestBorderPoint(tgt, wps.length > 1 ? wps[wps.length - 2] : srcCentre);
      wps[wps.length - 1] = { x: Math.round(newLast.x), y: Math.round(newLast.y) };
      // Keep orthogonality: snap second-to-last waypoint to match axis
      if (wps.length > 1) {
        const n = wps.length - 1;
        if (Math.abs(wps[n].x - wps[n - 1].x) < Math.abs(wps[n].y - wps[n - 1].y)) {
          wps[n - 1] = { x: wps[n].x, y: wps[n - 1].y }; // vertical segment
        } else {
          wps[n - 1] = { x: wps[n - 1].x, y: wps[n].y }; // horizontal segment
        }
      }
      changed = true;
    }

    if (changed) {
      // Deduplicate consecutive identical points
      const deduped = deduplicateWaypoints(wps);
      if (deduped.length >= 2) {
        modeling.updateWaypoints(conn, deduped);
      }
    }
  }
}

// ── Endpoint centre-snap pass ──────────────────────────────────────────────

/**
 * Snap flow waypoint endpoints to element centre lines.
 *
 * ELK uses port positions that may be offset from the element's geometric
 * centre, causing small Y-wobbles on horizontal flows or X-wobbles on
 * vertical flows.  This pass adjusts the first and last waypoints of each
 * connection so that:
 * - For primarily horizontal flows: the start point's Y matches the source
 *   centre Y, and the end point's Y matches the target centre Y.
 * - For primarily vertical flows: the start point's X matches the source
 *   centre X, and the end point's X matches the target centre X.
 *
 * Adjacent waypoints are adjusted to maintain orthogonality.
 * Boundary events and message flows are skipped (they have special routing).
 *
 * Should run after fixDisconnectedEdges and before snapAllConnectionsOrthogonal.
 */
export function snapEndpointsToElementCentres(
  elementRegistry: ElementRegistry,
  modeling: Modeling
): void {
  const BPMN_SEQUENCE_FLOW = 'bpmn:SequenceFlow';
  const BPMN_BOUNDARY_EVENT = 'bpmn:BoundaryEvent';
  const connections = elementRegistry.filter(
    (el) =>
      el.type === BPMN_SEQUENCE_FLOW &&
      !!el.source &&
      !!el.target &&
      !!el.waypoints &&
      el.waypoints.length >= 2 &&
      el.source.type !== BPMN_BOUNDARY_EVENT
  );

  for (const conn of connections) {
    const src = conn.source!;
    const tgt = conn.target!;
    const wps: Array<{ x: number; y: number }> = conn.waypoints!.map((wp: any) => ({
      x: wp.x,
      y: wp.y,
    }));

    const srcCy = Math.round(src.y + (src.height || 0) / 2);
    const srcCx = Math.round(src.x + (src.width || 0) / 2);
    const tgtCy = Math.round(tgt.y + (tgt.height || 0) / 2);
    const tgtCx = Math.round(tgt.x + (tgt.width || 0) / 2);

    let changed = false;
    const first = wps[0];
    const last = wps[wps.length - 1];

    // Determine if the flow is primarily horizontal or vertical
    const overallDx = Math.abs(last.x - first.x);
    const overallDy = Math.abs(last.y - first.y);
    const isHorizontal = overallDx >= overallDy;

    if (isHorizontal) {
      // Snap first waypoint Y to source centre Y
      const srcYDiff = Math.abs(first.y - srcCy);
      if (srcYDiff > 0.5 && srcYDiff <= CENTRE_SNAP_TOLERANCE) {
        first.y = srcCy;
        // Propagate to keep the first segment orthogonal
        if (wps.length > 1 && Math.abs(wps[1].y - first.y) < CENTRE_SNAP_TOLERANCE) {
          wps[1].y = first.y;
        }
        changed = true;
      }

      // Snap last waypoint Y to target centre Y
      const tgtYDiff = Math.abs(last.y - tgtCy);
      if (tgtYDiff > 0.5 && tgtYDiff <= CENTRE_SNAP_TOLERANCE) {
        last.y = tgtCy;
        // Propagate to keep the last segment orthogonal
        if (wps.length > 1) {
          const penultimate = wps[wps.length - 2];
          if (Math.abs(penultimate.y - last.y) < CENTRE_SNAP_TOLERANCE) {
            penultimate.y = last.y;
          }
        }
        changed = true;
      }
    } else {
      // Vertical flow: snap X to element centres
      const srcXDiff = Math.abs(first.x - srcCx);
      if (srcXDiff > 0.5 && srcXDiff <= CENTRE_SNAP_TOLERANCE) {
        first.x = srcCx;
        if (wps.length > 1 && Math.abs(wps[1].x - first.x) < CENTRE_SNAP_TOLERANCE) {
          wps[1].x = first.x;
        }
        changed = true;
      }

      const tgtXDiff = Math.abs(last.x - tgtCx);
      if (tgtXDiff > 0.5 && tgtXDiff <= CENTRE_SNAP_TOLERANCE) {
        last.x = tgtCx;
        if (wps.length > 1) {
          const penultimate = wps[wps.length - 2];
          if (Math.abs(penultimate.x - last.x) < CENTRE_SNAP_TOLERANCE) {
            penultimate.x = last.x;
          }
        }
        changed = true;
      }
    }

    if (changed) {
      modeling.updateWaypoints(conn, wps);
    }
  }
}
