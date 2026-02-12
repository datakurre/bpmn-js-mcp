/**
 * Core ELK edge section → bpmn-js waypoint conversion.
 *
 * Applies ELK's computed orthogonal edge routes as bpmn-js waypoints,
 * with fallback routing for connections ELK didn't handle.
 */

import type { ElkNode, ElkExtendedEdge, ElkEdgeSection } from 'elkjs';
import { isConnection } from './helpers';
import { deduplicateWaypoints } from './edge-routing-helpers';

/**
 * Tolerance (px) for snapping edge endpoints to element boundaries.
 * Covers gaps introduced by grid snap moving elements after ELK routing.
 */
const ENDPOINT_SNAP_TOLERANCE = 15;

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
  const BPMN_BOUNDARY_EVENT = 'bpmn:BoundaryEvent';
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
      const deduped = deduplicateWaypoints(waypoints, 0);

      // Snap endpoints to actual element boundaries.
      // Grid snap (step 5) may have moved elements after ELK computed the
      // edge routes, leaving small gaps (~10 px) between waypoints and
      // element borders.  Correct by adjusting the first/last waypoints
      // to touch the current element boundaries.
      // Only snaps straight horizontal flows (2 waypoints, same Y) to
      // avoid disturbing Z/L-shaped routes from gateways.
      const src = conn.source;
      const tgt = conn.target;
      if (deduped.length === 2) {
        const srcCy = Math.round(src.y + (src.height || 0) / 2);
        const srcRight = src.x + (src.width || 0);
        const tgtCy = Math.round(tgt.y + (tgt.height || 0) / 2);
        const tgtLeft = tgt.x;

        // Both waypoints on roughly the same Y = horizontal flow
        if (
          Math.abs(deduped[0].y - deduped[1].y) <= ENDPOINT_SNAP_TOLERANCE &&
          Math.abs(deduped[0].y - srcCy) <= ENDPOINT_SNAP_TOLERANCE &&
          Math.abs(deduped[1].y - tgtCy) <= ENDPOINT_SNAP_TOLERANCE
        ) {
          deduped[0] = { x: Math.round(srcRight), y: srcCy };
          deduped[1] = { x: Math.round(tgtLeft), y: tgtCy };
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

      if (src.type === BPMN_BOUNDARY_EVENT || conn.type === 'bpmn:MessageFlow') {
        // For boundary events, build a clean route from the boundary event
        // to the target: go down (or up) from the boundary event border,
        // then horizontally to the target.  bpmn-js ManhattanLayout can
        // produce backward routes in headless mode.
        if (src.type === BPMN_BOUNDARY_EVENT && tgt) {
          const srcCx = src.x + (src.width || 36) / 2;
          const srcBottom = src.y + (src.height || 36);
          const tgtW = tgt.width || 36;
          const tgtCy = tgt.y + (tgt.height || 36) / 2;

          // Enter target from the side facing the source (L-shaped route:
          // vertical from boundary event, then horizontal to target).
          // Use the left edge when the target is to the right of the
          // boundary event, or the right edge when it's to the left.
          const tgtCx = srcCx <= tgt.x + tgtW / 2 ? tgt.x : tgt.x + tgtW;

          // Determine if target is below or above the boundary event
          const goDown = tgtCy >= src.y;
          const startY = goDown ? srcBottom : src.y;

          const waypoints = [
            { x: Math.round(srcCx), y: Math.round(startY) },
            { x: Math.round(srcCx), y: Math.round(tgtCy) },
            { x: Math.round(tgtCx), y: Math.round(tgtCy) },
          ];

          // Deduplicate if source and target are aligned
          const deduped = deduplicateWaypoints(waypoints);

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
        const deduped = deduplicateWaypoints(rounded, 0);
        if (deduped.length >= 2) {
          modeling.updateWaypoints(conn, deduped);
        }
      }
    }
  }
}
