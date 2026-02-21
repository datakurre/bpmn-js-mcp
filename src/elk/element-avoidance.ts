/**
 * Post-layout element avoidance pass.
 *
 * After ELK layout and all edge routing passes, some sequence flow
 * waypoints may still pass through unrelated element bounding boxes.
 * This module detects and reroutes such intersections by adding
 * detour waypoints around the obstructing element.
 */

import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { type Point, type Rect, segmentIntersectsRect, cloneWaypoints } from '../geometry';
import { isConnection, isInfrastructure, isArtifact, isLane } from './helpers';
import { buildObstacleGrid, segmentBBox } from './spatial-index';

/** Margin (px) around elements for avoidance routing. */
const AVOIDANCE_MARGIN = 15;

/** Maximum iterations to prevent infinite loops. */
const MAX_ITERATIONS = 3;

/**
 * Avoid element intersections in connection waypoints.
 *
 * For each connection, tests every segment against all non-source/non-target
 * shapes.  When an intersection is detected, reroutes the segment around the
 * obstructing element using an H-V-H or V-H-V detour.
 */
export function avoidElementIntersections(
  elementRegistry: ElementRegistry,
  modeling: Modeling
): void {
  const allElements: BpmnElement[] = elementRegistry.getAll();

  // Collect all shapes that can obstruct flows
  const shapes = allElements.filter(
    (el) =>
      !isConnection(el.type) &&
      !isInfrastructure(el.type) &&
      !isLane(el.type) &&
      el.type !== 'label' &&
      el.type !== 'bpmn:BoundaryEvent' &&
      el.type !== 'bpmn:Participant' &&
      el.width !== undefined &&
      el.height !== undefined
  );

  // Collect all connections with waypoints
  const connections = allElements.filter(
    (el) => isConnection(el.type) && el.waypoints && el.waypoints.length >= 2
  );

  // H3: Build a single global obstacle grid for fast per-segment queries.
  // The grid covers the whole diagram; each connection's segments query
  // only nearby cells rather than scanning all shapes.
  const obstacleGrid = buildObstacleGrid(shapes);

  for (const conn of connections) {
    const sourceId = conn.source?.id;
    const targetId = conn.target?.id;
    if (!sourceId || !targetId) continue;

    // Skip connections from/to gateways with high fan-out/in — fan-out/fan-in
    // patterns inherently have connections that pass near branch elements.
    // Rerouting these creates more crossings than it solves.
    const source = conn.source;
    const target = conn.target;
    if (source?.type?.includes('Gateway') || target?.type?.includes('Gateway')) continue;

    // Collect boundary events attached to source/target (they overlap by design)
    const attachedBoundaryIds = new Set<string>();
    for (const el of allElements) {
      if (el.type === 'bpmn:BoundaryEvent' && el.host) {
        if (el.host.id === sourceId || el.host.id === targetId) {
          attachedBoundaryIds.add(el.id);
        }
      }
    }

    // Determine if this connection is inside an expanded subprocess.
    // If both source and target share the same subprocess parent, only
    // consider obstacles that are also direct children of that subprocess.
    // This prevents flows inside a subprocess from routing around the
    // subprocess container or siblings at the outer level.
    const sourceParent = source?.parent;
    const targetParent = target?.parent;
    const isInsideSubprocess =
      sourceParent &&
      targetParent &&
      sourceParent.id === targetParent.id &&
      sourceParent.type === 'bpmn:SubProcess';

    // H3: Build the set of valid obstacle IDs for this connection.
    // The spatial grid returns candidate shapes per segment; we filter
    // candidates through this set so only valid obstacles are considered.
    const validObstacleIds = new Set<string>();
    for (const s of shapes) {
      if (s.id === sourceId || s.id === targetId) continue;
      if (attachedBoundaryIds.has(s.id)) continue;
      if (isArtifact(s.type)) continue;

      // For connections inside a subprocess, only consider obstacles
      // that are also inside the same subprocess (direct children).
      if (isInsideSubprocess && s.parent?.id !== sourceParent.id) {
        continue;
      }

      validObstacleIds.add(s.id);
    }

    if (validObstacleIds.size === 0) continue;

    let modified = false;
    let wps = cloneWaypoints(conn.waypoints!);

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let anyFixed = false;

      for (let i = 0; i < wps.length - 1; i++) {
        const p1 = wps[i];
        const p2 = wps[i + 1];

        // H3: Query only shapes near this segment using the spatial grid.
        const segBox = segmentBBox(p1, p2, AVOIDANCE_MARGIN);
        const candidates = obstacleGrid
          .getCandidates(segBox)
          .filter((e) => validObstacleIds.has(e.element.id));

        for (const { element: obstacle } of candidates) {
          const rect: Rect = {
            x: obstacle.x - AVOIDANCE_MARGIN,
            y: obstacle.y - AVOIDANCE_MARGIN,
            width: (obstacle.width || 0) + 2 * AVOIDANCE_MARGIN,
            height: (obstacle.height || 0) + 2 * AVOIDANCE_MARGIN,
          };

          if (!segmentIntersectsRect(p1, p2, rect)) continue;

          // Compute a detour around the obstacle
          // H3: use all valid obstacles (not just candidates) for counting
          // new intersections — we only skip the per-segment spatial query
          // for the initial check, not for the detour quality assessment.
          const allObstacles = shapes.filter((s) => validObstacleIds.has(s.id));
          const detour = computeDetour(p1, p2, obstacle, AVOIDANCE_MARGIN, allObstacles);
          if (detour) {
            // Replace the segment with the detour
            wps.splice(i + 1, 0, ...detour);
            anyFixed = true;
            modified = true;
            break; // restart segment scan
          }
        }

        if (anyFixed) break; // restart from segment 0
      }

      if (!anyFixed) break;
    }

    if (modified) {
      // Deduplicate consecutive identical waypoints
      wps = deduplicateWps(wps);

      // Use modeling.updateWaypoints for proper DI/moddle integration.
      // Wrapped in try/catch because bpmn-js's LineAttachmentUtil can throw
      // on geometrically difficult paths (circle → line intersections).
      // Also skip if any waypoint has NaN coordinates (degenerate geometry).
      const hasNaN = wps.some((wp: Point) => isNaN(wp.x) || isNaN(wp.y));
      if (hasNaN) continue;

      try {
        modeling.updateWaypoints(conn, wps);
      } catch {
        // Silently skip — leave the original waypoints unchanged
      }
    }
  }
}

/**
 * Compute detour waypoints to route around an obstacle.
 *
 * For horizontal segments passing through an element, routes above or
 * below.  For vertical segments, routes left or right.  Chooses the
 * direction that minimises new intersections.
 */
function computeDetour(
  p1: Point,
  p2: Point,
  obstacle: BpmnElement,
  margin: number,
  allObstacles: BpmnElement[]
): Point[] | null {
  const obX = obstacle.x;
  const obY = obstacle.y;
  const obW = obstacle.width || 0;
  const obH = obstacle.height || 0;

  // Guard against degenerate geometry (NaN or undefined coordinates)
  if (isNaN(obX) || isNaN(obY) || isNaN(p1.x) || isNaN(p1.y) || isNaN(p2.x) || isNaN(p2.y)) {
    return null;
  }

  const isHorizontal = Math.abs(p1.y - p2.y) < Math.abs(p1.x - p2.x);

  if (isHorizontal) {
    // Route above or below the obstacle.
    // Clamp entryX/exitX to the horizontal span of the original segment so
    // the detour never extends backward past the source or forward past the
    // target.  This prevents the avoidance pass from generating oscillating
    // paths that repeatedly visit waypoints outside the p1→p2 range.
    const aboveY = obY - margin;
    const belowY = obY + obH + margin;
    const segMinX = Math.min(p1.x, p2.x);
    const segMaxX = Math.max(p1.x, p2.x);
    const entryX = Math.max(segMinX, Math.min(p1.x, p2.x, obX - margin));
    const exitX = Math.min(segMaxX, Math.max(p1.x, p2.x, obX + obW + margin));

    // Choose direction with fewer new intersections (prefer above)
    const aboveDetour: Point[] = [
      { x: entryX, y: p1.y },
      { x: entryX, y: aboveY },
      { x: exitX, y: aboveY },
      { x: exitX, y: p2.y },
    ];

    const belowDetour: Point[] = [
      { x: entryX, y: p1.y },
      { x: entryX, y: belowY },
      { x: exitX, y: belowY },
      { x: exitX, y: p2.y },
    ];

    const aboveIntersections = countDetourIntersections(aboveDetour, allObstacles, obstacle.id);
    const belowIntersections = countDetourIntersections(belowDetour, allObstacles, obstacle.id);

    return aboveIntersections <= belowIntersections ? aboveDetour : belowDetour;
  } else {
    // Route left or right of the obstacle.
    // Clamp entryY/exitY to the vertical span of the original segment.
    const leftX = obX - margin;
    const rightX = obX + obW + margin;
    const segMinY = Math.min(p1.y, p2.y);
    const segMaxY = Math.max(p1.y, p2.y);
    const entryY = Math.max(segMinY, Math.min(p1.y, p2.y, obY - margin));
    const exitY = Math.min(segMaxY, Math.max(p1.y, p2.y, obY + obH + margin));

    const leftDetour: Point[] = [
      { x: p1.x, y: entryY },
      { x: leftX, y: entryY },
      { x: leftX, y: exitY },
      { x: p2.x, y: exitY },
    ];

    const rightDetour: Point[] = [
      { x: p1.x, y: entryY },
      { x: rightX, y: entryY },
      { x: rightX, y: exitY },
      { x: p2.x, y: exitY },
    ];

    const leftIntersections = countDetourIntersections(leftDetour, allObstacles, obstacle.id);
    const rightIntersections = countDetourIntersections(rightDetour, allObstacles, obstacle.id);

    return leftIntersections <= rightIntersections ? leftDetour : rightDetour;
  }
}

/**
 * Count how many obstacles a detour path intersects (excluding the
 * obstacle being avoided).
 */
function countDetourIntersections(
  detour: Point[],
  allObstacles: BpmnElement[],
  excludeId: string
): number {
  let count = 0;
  for (const obs of allObstacles) {
    if (obs.id === excludeId) continue;
    const rect: Rect = {
      x: obs.x,
      y: obs.y,
      width: obs.width || 0,
      height: obs.height || 0,
    };
    for (let i = 0; i < detour.length - 1; i++) {
      if (segmentIntersectsRect(detour[i], detour[i + 1], rect)) {
        count++;
        break;
      }
    }
  }
  return count;
}

/** Remove consecutive duplicate waypoints. */
function deduplicateWps(wps: Point[]): Point[] {
  const result: Point[] = [wps[0]];
  for (let i = 1; i < wps.length; i++) {
    if (
      Math.abs(wps[i].x - result[result.length - 1].x) > 0.5 ||
      Math.abs(wps[i].y - result[result.length - 1].y) > 0.5
    ) {
      result.push(wps[i]);
    }
  }
  return result;
}
