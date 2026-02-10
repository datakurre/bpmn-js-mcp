/**
 * ELK edge section → bpmn-js waypoint conversion and routing.
 */

import type { ElkNode, ElkExtendedEdge, ElkEdgeSection } from 'elkjs';
import { isConnection } from './helpers';

/**
 * Build a flat lookup of ELK edges (including nested containers) so we can
 * resolve edge sections by connection ID.
 */
function collectElkEdges(
  elkNode: ElkNode,
  parentAbsX: number,
  parentAbsY: number
): Map<string, { sections: ElkEdgeSection[]; offsetX: number; offsetY: number }> {
  const map = new Map<string, { sections: ElkEdgeSection[]; offsetX: number; offsetY: number }>();

  // Edges at this level
  const edges = (elkNode as any).edges as ElkExtendedEdge[] | undefined;
  if (edges) {
    for (const edge of edges) {
      if (edge.sections && edge.sections.length > 0) {
        map.set(edge.id, { sections: edge.sections, offsetX: parentAbsX, offsetY: parentAbsY });
      }
    }
  }

  // Recurse into children (compound nodes)
  if (elkNode.children) {
    for (const child of elkNode.children) {
      if (child.children && child.children.length > 0) {
        const childAbsX = parentAbsX + (child.x ?? 0);
        const childAbsY = parentAbsY + (child.y ?? 0);
        const nested = collectElkEdges(child, childAbsX, childAbsY);
        for (const [id, val] of nested) {
          map.set(id, val);
        }
      }
    }
  }

  return map;
}

/**
 * Build strictly orthogonal waypoints between two points.
 *
 * If the source and target share the same X or Y (within tolerance),
 * a straight horizontal/vertical segment is used.  Otherwise, an L-shaped
 * route is produced: horizontal first if the primary direction is
 * left-to-right, vertical first otherwise.
 */
function buildOrthogonalWaypoints(
  src: { x: number; y: number },
  tgt: { x: number; y: number }
): Array<{ x: number; y: number }> {
  const dx = Math.abs(tgt.x - src.x);
  const dy = Math.abs(tgt.y - src.y);

  // Nearly aligned — straight segment
  if (dx < 2) {
    return [
      { x: src.x, y: src.y },
      { x: src.x, y: tgt.y },
    ];
  }
  if (dy < 2) {
    return [
      { x: src.x, y: src.y },
      { x: tgt.x, y: src.y },
    ];
  }

  // L-shaped route: go horizontal from src, then vertical to tgt
  if (dx >= dy) {
    return [
      { x: src.x, y: src.y },
      { x: tgt.x, y: src.y },
      { x: tgt.x, y: tgt.y },
    ];
  }

  // Primarily vertical: go vertical first, then horizontal
  return [
    { x: src.x, y: src.y },
    { x: src.x, y: tgt.y },
    { x: tgt.x, y: tgt.y },
  ];
}

/**
 * Apply ELK-computed orthogonal edge routes directly as bpmn-js waypoints.
 *
 * ELK returns edge sections with startPoint, endPoint, and optional
 * bendPoints — all in coordinates relative to the parent container.
 * We convert to absolute diagram coordinates and set them via
 * `modeling.updateWaypoints()` which also updates the BPMN DI.
 *
 * For connections where ELK didn't produce sections (e.g. cross-container
 * message flows), we fall back to `modeling.layoutConnection()`.
 */
export function applyElkEdgeRoutes(
  elementRegistry: any,
  modeling: any,
  elkResult: ElkNode,
  offsetX: number,
  offsetY: number
): void {
  const edgeLookup = collectElkEdges(elkResult, offsetX, offsetY);

  const allConnections = elementRegistry.filter(
    (el: any) => isConnection(el.type) && el.source && el.target
  );

  for (const conn of allConnections) {
    const elkEdge = edgeLookup.get(conn.id);

    if (elkEdge && elkEdge.sections.length > 0) {
      // Use ELK's computed orthogonal route
      const section = elkEdge.sections[0];
      const ox = elkEdge.offsetX;
      const oy = elkEdge.offsetY;

      const waypoints: Array<{ x: number; y: number }> = [];
      waypoints.push({
        x: Math.round(ox + section.startPoint.x),
        y: Math.round(oy + section.startPoint.y),
      });
      if (section.bendPoints) {
        for (const bp of section.bendPoints) {
          waypoints.push({ x: Math.round(ox + bp.x), y: Math.round(oy + bp.y) });
        }
      }
      waypoints.push({
        x: Math.round(ox + section.endPoint.x),
        y: Math.round(oy + section.endPoint.y),
      });

      // Snap near-horizontal/vertical segments to strict orthogonal.
      // ELK can produce small offsets (up to ~8 px) due to node-size rounding
      // and port placement, so we use a generous tolerance.
      for (let i = 1; i < waypoints.length; i++) {
        const prev = waypoints[i - 1];
        const curr = waypoints[i];
        if (Math.abs(curr.y - prev.y) < 8) {
          curr.y = prev.y;
        }
        if (Math.abs(curr.x - prev.x) < 8) {
          curr.x = prev.x;
        }
      }

      // Deduplicate consecutive identical waypoints (e.g. redundant bend points)
      const deduped = [waypoints[0]];
      for (let i = 1; i < waypoints.length; i++) {
        const prev = deduped[deduped.length - 1];
        if (prev.x !== waypoints[i].x || prev.y !== waypoints[i].y) {
          deduped.push(waypoints[i]);
        }
      }

      modeling.updateWaypoints(conn, deduped);
    } else {
      // Fallback: use bpmn-js built-in connection layout for connections
      // that ELK didn't route (boundary events, cross-container flows).
      // This delegates to bpmn-js ManhattanLayout which produces clean
      // orthogonal paths that respect element boundaries.
      const src = conn.source;
      const tgt = conn.target;

      if (src.type === 'bpmn:BoundaryEvent' || conn.type === 'bpmn:MessageFlow') {
        // For boundary events, build a clean route from the boundary event
        // to the target: go down (or up) from the boundary event border,
        // then horizontally to the target.  bpmn-js ManhattanLayout can
        // produce backward routes in headless mode.
        if (src.type === 'bpmn:BoundaryEvent' && tgt) {
          const srcCx = src.x + (src.width || 36) / 2;
          const srcBottom = src.y + (src.height || 36);
          const tgtCx = tgt.x + (tgt.width || 36) / 2;
          const tgtCy = tgt.y + (tgt.height || 36) / 2;

          // Determine if target is below or above the boundary event
          const goDown = tgtCy >= src.y;
          const startY = goDown ? srcBottom : src.y;

          const waypoints = [
            { x: Math.round(srcCx), y: Math.round(startY) },
            { x: Math.round(srcCx), y: Math.round(tgtCy) },
            { x: Math.round(tgtCx), y: Math.round(tgtCy) },
          ];

          // Deduplicate if source and target are aligned
          const deduped = [waypoints[0]];
          for (let i = 1; i < waypoints.length; i++) {
            const prev = deduped[deduped.length - 1];
            if (Math.abs(prev.x - waypoints[i].x) > 1 || Math.abs(prev.y - waypoints[i].y) > 1) {
              deduped.push(waypoints[i]);
            }
          }

          if (deduped.length >= 2) {
            modeling.updateWaypoints(conn, deduped);
          } else {
            modeling.layoutConnection(conn);
          }
        } else {
          // Message flows — let bpmn-js handle routing
          modeling.layoutConnection(conn);
        }
      } else {
        // Generic fallback for other unrouted connections
        const srcMid = { x: src.x + (src.width || 0) / 2, y: src.y + (src.height || 0) / 2 };
        const tgtMid = { x: tgt.x + (tgt.width || 0) / 2, y: tgt.y + (tgt.height || 0) / 2 };
        const waypoints = buildOrthogonalWaypoints(srcMid, tgtMid);

        // Round and deduplicate fallback waypoints
        const rounded = waypoints.map((wp) => ({ x: Math.round(wp.x), y: Math.round(wp.y) }));
        const dedupedFallback = [rounded[0]];
        for (let i = 1; i < rounded.length; i++) {
          const prev = dedupedFallback[dedupedFallback.length - 1];
          if (prev.x !== rounded[i].x || prev.y !== rounded[i].y) {
            dedupedFallback.push(rounded[i]);
          }
        }
        if (dedupedFallback.length >= 2) {
          modeling.updateWaypoints(conn, dedupedFallback);
        }
      }
    }
  }
}

// ── Disconnected edge repair ───────────────────────────────────────────────

/** Distance threshold (px) — edge endpoint is "disconnected" if further. */
const DISCONNECT_THRESHOLD = 20;

/** Get the centre point of an element. */
function elementCentre(el: any): { x: number; y: number } {
  return {
    x: el.x + (el.width || 0) / 2,
    y: el.y + (el.height || 0) / 2,
  };
}

/** Get the nearest attachment point on an element's boundary for a given external point. */
function nearestBorderPoint(el: any, point: { x: number; y: number }): { x: number; y: number } {
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
export function fixDisconnectedEdges(elementRegistry: any, modeling: any): void {
  const connections = elementRegistry.filter(
    (el: any) => isConnection(el.type) && el.source && el.target && el.waypoints?.length >= 2
  );

  for (const conn of connections) {
    const src = conn.source;
    const tgt = conn.target;
    const wps: Array<{ x: number; y: number }> = conn.waypoints.map((wp: any) => ({
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
    if (Math.abs(srcCentre.y - tgtCentre.y) < 5) {
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
      const deduped = [wps[0]];
      for (let i = 1; i < wps.length; i++) {
        const prev = deduped[deduped.length - 1];
        if (Math.abs(prev.x - wps[i].x) > 1 || Math.abs(prev.y - wps[i].y) > 1) {
          deduped.push(wps[i]);
        }
      }
      if (deduped.length >= 2) {
        modeling.updateWaypoints(conn, deduped);
      }
    }
  }
}
