/**
 * Post-ELK lane repositioning.
 *
 * Lanes are excluded from the ELK graph (they are structural containers,
 * not flow nodes). After ELK lays out the flow elements within a
 * participant pool, this module:
 *
 * 1. Shifts flow nodes vertically so that each lane's nodes occupy a
 *    separate Y-band (ELK places them all on one row).
 * 2. Resizes the participant pool to encompass all lane bands.
 * 3. Positions and resizes each lane to tile vertically inside the pool.
 *
 * Lane–flow-node assignment comes from the BPMN model's
 * `bpmn:Lane.flowNodeRef` collection, which bpmn-js preserves in
 * `lane.businessObject.flowNodeRef`.
 *
 * **Important:** The `flowNodeRef` arrays get mutated by bpmn-js when
 * `modeling.moveElements` shifts nodes across lane boundaries.  The
 * original assignments must be captured **before** any layout passes
 * via `saveLaneNodeAssignments()` and passed in to `repositionLanes()`.
 */

/** Saved lane → node ID mapping, keyed by lane ID. */
export type LaneNodeAssignments = Map<string, Set<string>>;

import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { MIN_LANE_HEIGHT, POOL_LABEL_BAND, LANE_VERTICAL_PADDING } from './constants';
import { deduplicateWaypoints } from './edge-routing-helpers';
import { isConnection, isInfrastructure, isArtifact, isLane } from './helpers';

/** Margin (px) inside lane edges for clamping waypoints. */
const LANE_CLAMP_MARGIN = 5;

/** Returns true for types that should not be assigned to lanes. */
function isLaneOrInfrastructure(type: string): boolean {
  return (
    isLane(type) ||
    isInfrastructure(type) ||
    isConnection(type) ||
    isArtifact(type) ||
    type === 'bpmn:BoundaryEvent' ||
    type === 'label'
  );
}

/**
 * Saved lane metadata: original Y-position (from DI coordinates)
 * and assigned flow node IDs.
 */
interface LaneSnapshot {
  laneId: string;
  originalY: number;
  nodeIds: Set<string>;
}

/**
 * Capture lane → flow-node assignments before layout mutates them.
 *
 * bpmn-js's `modeling.moveElements` updates `lane.businessObject.flowNodeRef`
 * when a node crosses lane boundaries.  This function snapshots the original
 * assignments so `repositionLanes()` can use them later.
 *
 * Call this **before** any ELK layout passes (before `applyElkPositions`).
 */
export function saveLaneNodeAssignments(elementRegistry: ElementRegistry): LaneSnapshot[] {
  const snapshots: LaneSnapshot[] = [];
  const lanes = elementRegistry.filter((el) => el.type === 'bpmn:Lane');

  for (const lane of lanes) {
    const bo = lane.businessObject;
    const refs = (bo?.flowNodeRef || []) as Array<{ id: string }>;
    const nodeIds = new Set<string>();

    for (const ref of refs) {
      const shape = elementRegistry.get(ref.id);
      if (shape) {
        nodeIds.add(shape.id);
      }
    }

    snapshots.push({
      laneId: lane.id,
      originalY: lane.y,
      nodeIds,
    });
  }

  return snapshots;
}

/**
 * Reposition lanes and their flow nodes inside participant pools after
 * ELK layout.
 *
 * ELK treats all flow nodes in a pool as a flat graph without lane
 * awareness.  After ELK positioning (and centreElementsInPools), all
 * nodes sit on roughly the same row.  This function separates them
 * into distinct vertical bands — one per lane — so the final layout
 * shows clear lane boundaries.
 *
 * @param savedAssignments  Lane snapshots from `saveLaneNodeAssignments()`,
 *   captured before layout.  If empty/undefined, falls back to reading
 *   the (possibly mutated) `flowNodeRef` from the business objects.
 */
export function repositionLanes(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  savedAssignments?: LaneSnapshot[],
  laneStrategy?: 'preserve' | 'optimize'
): void {
  const participants = elementRegistry.filter((el) => el.type === 'bpmn:Participant');

  for (const pool of participants) {
    const lanes = elementRegistry.filter((el) => el.type === 'bpmn:Lane' && el.parent === pool);

    if (lanes.length === 0) continue;

    // Build lane → flow node IDs mapping.
    // Prefer saved assignments (captured before layout mutated flowNodeRef).
    const laneNodeMap = new Map<string, Set<string>>();
    let orderedLanes: BpmnElement[];

    if (savedAssignments && savedAssignments.length > 0) {
      // Filter saved snapshots to lanes in this pool
      const poolLaneIds = new Set(lanes.map((l) => l.id));
      const poolSnapshots = savedAssignments.filter((s) => poolLaneIds.has(s.laneId));

      // Sort lanes by their original DI Y-position (before layout moved them)
      const originalYMap = new Map<string, number>();
      for (const snap of poolSnapshots) {
        laneNodeMap.set(snap.laneId, snap.nodeIds);
        originalYMap.set(snap.laneId, snap.originalY);
      }

      orderedLanes = [...lanes].sort((a, b) => {
        const ya = originalYMap.get(a.id) ?? a.y;
        const yb = originalYMap.get(b.id) ?? b.y;
        return ya - yb;
      });
    } else {
      // Fallback: read from (possibly mutated) flowNodeRef
      const fallbackMap = buildLaneNodeMap(lanes, elementRegistry);
      for (const [k, v] of fallbackMap) laneNodeMap.set(k, v);
      orderedLanes = [...lanes].sort((a, b) => a.y - b.y);
    }

    // Skip if no lane has any assigned nodes
    const hasNodes = Array.from(laneNodeMap.values()).some((s) => s.size > 0);
    if (!hasNodes) continue;

    // Detect flow nodes inside the pool that aren't assigned to any lane.
    // This can happen when elements are added after lanes are created, or
    // when a lane is deleted and its nodes become orphaned.
    // Auto-assign orphaned nodes to the nearest lane (by Y-centre distance).
    const allAssignedIds = new Set<string>();
    for (const ids of laneNodeMap.values()) {
      for (const id of ids) allAssignedIds.add(id);
    }

    const unassigned = elementRegistry.filter(
      (el) => el.parent === pool && !isLaneOrInfrastructure(el.type) && !allAssignedIds.has(el.id)
    );

    if (unassigned.length > 0) {
      // Auto-assign each orphan to the nearest lane by Y-centre distance
      for (const orphan of unassigned) {
        const orphanCy = orphan.y + (orphan.height || 0) / 2;
        let bestLane: BpmnElement | null = null;
        let bestDist = Infinity;
        for (const lane of orderedLanes) {
          const laneCy = lane.y + lane.height / 2;
          const d = Math.abs(orphanCy - laneCy);
          if (d < bestDist) {
            bestDist = d;
            bestLane = lane;
          }
        }
        if (bestLane) {
          const set = laneNodeMap.get(bestLane.id);
          if (set) set.add(orphan.id);
        }
      }
    }

    // Optimize lane order to minimise cross-lane flows if requested
    if (laneStrategy === 'optimize' && orderedLanes.length > 1) {
      orderedLanes = optimizeLaneOrder(orderedLanes, laneNodeMap, elementRegistry);
    }

    // Compute the height of node content in each lane (single-row height)
    const laneContentHeight = new Map<string, number>();
    for (const lane of orderedLanes) {
      const nodeIds = laneNodeMap.get(lane.id);
      if (!nodeIds || nodeIds.size === 0) {
        laneContentHeight.set(lane.id, 0);
        continue;
      }
      let maxH = 0;
      for (const nodeId of nodeIds) {
        const shape = elementRegistry.get(nodeId);
        if (shape) {
          const h = shape.height || 0;
          if (h > maxH) maxH = h;
        }
      }
      laneContentHeight.set(lane.id, maxH);
    }

    // Compute lane band heights (content height + vertical padding, min enforced)
    const laneBandHeights = new Map<string, number>();
    for (const lane of orderedLanes) {
      const contentH = laneContentHeight.get(lane.id) || 0;
      const bandH = Math.max(contentH + LANE_VERTICAL_PADDING * 2, MIN_LANE_HEIGHT);
      laneBandHeights.set(lane.id, bandH);
    }

    // Total minimum height for all lane bands
    const totalLaneHeight = Array.from(laneBandHeights.values()).reduce((a, b) => a + b, 0);

    const poolX = pool.x;
    const poolY = pool.y;
    const poolWidth = pool.width;

    const newPoolHeight = totalLaneHeight;

    // Compute Y-band for each lane
    const laneBandY = new Map<string, number>();
    let currentBandY = poolY;
    for (const lane of orderedLanes) {
      laneBandY.set(lane.id, currentBandY);
      currentBandY += laneBandHeights.get(lane.id)!;
    }

    // Move flow nodes into their lane's Y-band.
    // Each node is vertically centred in its lane band.
    for (const lane of orderedLanes) {
      const nodeIds = laneNodeMap.get(lane.id);
      if (!nodeIds || nodeIds.size === 0) continue;

      const bandY = laneBandY.get(lane.id)!;
      const bandH = laneBandHeights.get(lane.id)!;
      const bandCentreY = bandY + bandH / 2;

      const shapes: BpmnElement[] = [];
      for (const nodeId of nodeIds) {
        const shape = elementRegistry.get(nodeId);
        if (shape) shapes.push(shape);
      }

      if (shapes.length === 0) continue;

      // Compute median Y-centre of the lane's nodes (they are likely
      // on the same row after ELK + centreElementsInPools)
      const yCentres = shapes.map((s) => s.y + (s.height || 0) / 2);
      yCentres.sort((a, b) => a - b);
      const medianCentre = yCentres[Math.floor(yCentres.length / 2)];

      const dy = Math.round(bandCentreY - medianCentre);

      if (Math.abs(dy) > 1) {
        modeling.moveElements(shapes, { x: 0, y: dy });
      }
    }

    // Position and resize each lane to tile vertically inside the pool.
    // Resize lanes FIRST, then correct the pool height.  Doing the pool
    // resize first would cause bpmn-js to proportionally redistribute
    // lanes, distorting the target heights.
    const laneX = poolX + POOL_LABEL_BAND;
    const laneWidth = poolWidth - POOL_LABEL_BAND;

    for (const lane of orderedLanes) {
      const targetY = laneBandY.get(lane.id)!;
      const targetH = laneBandHeights.get(lane.id)!;

      // Resize lane to target dimensions
      modeling.resizeShape(lane, {
        x: laneX,
        y: targetY,
        width: laneWidth,
        height: targetH,
      });
    }

    // Correct pool height to match the sum of lane bands.
    // bpmn-js auto-adjusts the pool during lane resizing, but the
    // cumulative result may not exactly equal totalLaneHeight.
    const updatedPool = elementRegistry.get(pool.id)!;
    if (Math.abs(updatedPool.height - newPoolHeight) > 1) {
      modeling.resizeShape(updatedPool, {
        x: updatedPool.x,
        y: updatedPool.y,
        width: updatedPool.width,
        height: newPoolHeight,
      });
    }

    // Re-verify lanes: pool resize may have redistributed them.
    // A single correction pass is sufficient.
    for (const lane of orderedLanes) {
      const current = elementRegistry.get(lane.id)!;
      const targetY = laneBandY.get(lane.id)!;
      const targetH = laneBandHeights.get(lane.id)!;
      if (Math.abs(current.height - targetH) > 2 || Math.abs(current.y - targetY) > 2) {
        modeling.resizeShape(current, {
          x: current.x,
          y: targetY,
          width: current.width,
          height: targetH,
        });
      }
    }
  }
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Build a map of lane ID → set of flow node element IDs.
 *
 * Uses the BPMN model's `lane.businessObject.flowNodeRef` which contains
 * references to the flow node business objects assigned to each lane.
 */
function buildLaneNodeMap(
  lanes: BpmnElement[],
  elementRegistry: ElementRegistry
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const lane of lanes) {
    const bo = lane.businessObject;
    const refs = (bo?.flowNodeRef || []) as Array<{ id: string }>;
    const nodeIds = new Set<string>();

    for (const ref of refs) {
      // flowNodeRef contains business objects; find the corresponding shape
      const shape = elementRegistry.get(ref.id);
      if (shape) {
        nodeIds.add(shape.id);
      }
    }

    // Always register the lane, even if empty — consistent with the
    // saved-assignment path so empty lanes get positioned correctly.
    map.set(lane.id, nodeIds);
  }

  return map;
}
/**
 * Compute the number of cross-lane sequence flow "crossings" for a
 * given lane ordering.
 *
 * A crossing occurs when a sequence flow goes from lane at index i
 * to lane at index j, and another flow goes from lane at index k to
 * lane at index l, where (i < k && j > l) or (i > k && j < l).
 *
 * Additionally, we penalise "long" jumps: a flow between lane i and
 * lane j costs |i - j| (adjacent = 1, skip-one = 2, etc.).  This
 * prefers orderings where connected lanes are adjacent.
 */
function computeLaneCrossingCost(
  laneOrder: BpmnElement[],
  adjacencyPairs: Array<[string, string]>
): number {
  const laneIndex = new Map<string, number>();
  for (let i = 0; i < laneOrder.length; i++) {
    laneIndex.set(laneOrder[i].id, i);
  }

  // Sum of distances: prefer adjacent connected lanes
  let cost = 0;
  for (const [srcLane, tgtLane] of adjacencyPairs) {
    const si = laneIndex.get(srcLane);
    const ti = laneIndex.get(tgtLane);
    if (si !== undefined && ti !== undefined) {
      cost += Math.abs(si - ti);
    }
  }
  return cost;
}

/**
 * Optimise lane order to minimise the total distance of cross-lane
 * sequence flows.  Uses a greedy adjacent-swap approach (bubble sort
 * style) which is efficient for the typical 2–6 lanes.
 *
 * For ≤ 8 lanes, tries all permutations (8! = 40 320).
 * For > 8 lanes (rare), uses greedy adjacent swaps.
 */
function optimizeLaneOrder(
  lanes: BpmnElement[],
  laneNodeMap: Map<string, Set<string>>,
  elementRegistry: ElementRegistry
): BpmnElement[] {
  // Build adjacency pairs: (sourceLaneId, targetLaneId) for each
  // cross-lane sequence flow.
  const nodeToLane = new Map<string, string>();
  for (const [laneId, nodeIds] of laneNodeMap) {
    for (const nodeId of nodeIds) {
      nodeToLane.set(nodeId, laneId);
    }
  }

  const adjacencyPairs: Array<[string, string]> = [];
  const sequenceFlows = elementRegistry.filter(
    (el: BpmnElement) => el.type === 'bpmn:SequenceFlow' && !!el.source && !!el.target
  );

  for (const flow of sequenceFlows) {
    const srcLane = nodeToLane.get(flow.source!.id);
    const tgtLane = nodeToLane.get(flow.target!.id);
    if (srcLane && tgtLane && srcLane !== tgtLane) {
      adjacencyPairs.push([srcLane, tgtLane]);
    }
  }

  // No cross-lane flows — order doesn't matter, keep original
  if (adjacencyPairs.length === 0) return lanes;

  if (lanes.length <= 8) {
    // Brute-force: try all permutations
    return bruteForceOptimal(lanes, adjacencyPairs);
  }

  // Greedy adjacent-swap optimisation
  const order = [...lanes];
  let bestCost = computeLaneCrossingCost(order, adjacencyPairs);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      // Try swapping adjacent lanes
      [order[i], order[i + 1]] = [order[i + 1], order[i]];
      const newCost = computeLaneCrossingCost(order, adjacencyPairs);
      if (newCost < bestCost) {
        bestCost = newCost;
        improved = true;
      } else {
        // Swap back
        [order[i], order[i + 1]] = [order[i + 1], order[i]];
      }
    }
  }

  return order;
}

/**
 * Try all permutations and return the one with the lowest crossing cost.
 */
function bruteForceOptimal(
  lanes: BpmnElement[],
  adjacencyPairs: Array<[string, string]>
): BpmnElement[] {
  let bestOrder = lanes;
  let bestCost = computeLaneCrossingCost(lanes, adjacencyPairs);

  function permute(arr: BpmnElement[], start: number): void {
    if (start === arr.length) {
      const cost = computeLaneCrossingCost(arr, adjacencyPairs);
      if (cost < bestCost) {
        bestCost = cost;
        bestOrder = [...arr];
      }
      return;
    }
    for (let i = start; i < arr.length; i++) {
      [arr[start], arr[i]] = [arr[i], arr[start]];
      permute(arr, start + 1);
      [arr[start], arr[i]] = [arr[i], arr[start]];
    }
  }

  permute([...lanes], 0);
  return bestOrder;
}

// ── Intra-lane flow clamping ────────────────────────────────────────────────

/**
 * Clamp intra-lane sequence flow waypoints to stay within their lane's
 * Y-bounds.  Cross-lane flows (source and target in different lanes) are
 * left unchanged.
 *
 * After ELK layout and lane repositioning, edge routes are computed from
 * ELK sections that predate lane repositioning.  Intermediate waypoints
 * may therefore escape the lane band.  This pass clamps them back in.
 *
 * To preserve orthogonal routing, consecutive waypoints that form a
 * horizontal segment are clamped to the same Y value.
 */
export function clampFlowsToLaneBounds(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const lanes = elementRegistry.filter((el: BpmnElement) => el.type === 'bpmn:Lane');
  if (lanes.length === 0) return;

  // Build node → lane map from flowNodeRef
  const nodeToLane = new Map<string, BpmnElement>();
  for (const lane of lanes) {
    const bo = lane.businessObject;
    const refs = (bo?.flowNodeRef || []) as Array<{ id: string }>;
    for (const ref of refs) {
      const shape = elementRegistry.get(ref.id);
      if (shape) {
        nodeToLane.set(shape.id, lane);
      }
    }
  }

  const connections = elementRegistry.filter((el: BpmnElement) => el.type === 'bpmn:SequenceFlow');

  for (const conn of connections) {
    if (!conn.source || !conn.target || !conn.waypoints || conn.waypoints.length < 2) continue;

    const srcLane = nodeToLane.get(conn.source.id);
    const tgtLane = nodeToLane.get(conn.target.id);

    // Only clamp intra-lane flows
    if (!srcLane || !tgtLane || srcLane.id !== tgtLane.id) continue;

    const lane = srcLane;
    const minY = lane.y + LANE_CLAMP_MARGIN;
    const maxY = lane.y + lane.height - LANE_CLAMP_MARGIN;

    // Check if any waypoint is outside bounds
    let needsClamping = false;
    for (const wp of conn.waypoints) {
      if (wp.y < minY || wp.y > maxY) {
        needsClamping = true;
        break;
      }
    }
    if (!needsClamping) continue;

    // Clamp waypoints while preserving orthogonal segments.
    // Group consecutive waypoints with the same Y into horizontal segments
    // and clamp them to the same Y value.
    const wps: Array<{ x: number; y: number }> = conn.waypoints.map(
      (wp: { x: number; y: number }) => ({ x: wp.x, y: wp.y })
    );

    clampWaypointsPreservingOrthogonality(wps, minY, maxY);
    modeling.updateWaypoints(conn, wps);
  }
}

/**
 * Clamp waypoint Y-values to [minY, maxY] while preserving horizontal
 * segment alignment.  Consecutive waypoints within 2px Y-tolerance are
 * treated as a horizontal segment and clamped to the same Y.
 */
function clampWaypointsPreservingOrthogonality(
  wps: Array<{ x: number; y: number }>,
  minY: number,
  maxY: number
): void {
  const HORIZONTAL_TOLERANCE = 2;

  // Identify horizontal segments: groups of consecutive points at ~same Y
  let i = 0;
  while (i < wps.length) {
    // Find the extent of this horizontal segment
    let j = i + 1;
    while (j < wps.length && Math.abs(wps[j].y - wps[i].y) <= HORIZONTAL_TOLERANCE) {
      j++;
    }

    // All waypoints from i to j-1 form a horizontal segment
    // Use the average Y, then clamp
    let avgY = 0;
    for (let k = i; k < j; k++) avgY += wps[k].y;
    avgY /= j - i;

    const clampedY = Math.max(minY, Math.min(maxY, avgY));

    for (let k = i; k < j; k++) {
      wps[k].y = clampedY;
    }

    i = j;
  }
}

// ── Cross-lane staircase routing ────────────────────────────────────────────

/**
 * Route cross-lane sequence flows as orthogonal staircases through lane
 * boundaries.
 *
 * After lane repositioning, cross-lane flows may have stale waypoints
 * from the pre-lane ELK pass. This function rebuilds them as clean
 * staircase routes:
 *
 * - **Single-lane crossing:** Z-shape (horizontal → vertical at gap
 *   midpoint → horizontal).
 * - **Multi-lane crossing:** stepped staircase with a vertical transition
 *   at each intermediate lane boundary, producing a "staircase" pattern
 *   that makes the lane crossing visually explicit.
 *
 * Only cross-lane flows (source and target in different lanes) are
 * affected. Intra-lane flows and flows between elements outside any lane
 * are left unchanged.
 */
export function routeCrossLaneStaircase(
  elementRegistry: ElementRegistry,
  modeling: Modeling
): void {
  const lanes = elementRegistry.filter((el: BpmnElement) => el.type === 'bpmn:Lane');
  if (lanes.length < 2) return;

  // Build node → lane mapping
  const nodeToLane = new Map<string, BpmnElement>();
  for (const lane of lanes) {
    const bo = lane.businessObject;
    const refs = (bo?.flowNodeRef || []) as Array<{ id: string }>;
    for (const ref of refs) {
      const shape = elementRegistry.get(ref.id);
      if (shape) nodeToLane.set(shape.id, lane);
    }
  }

  // Sort lanes by Y-position (top to bottom)
  const sortedLanes = [...lanes].sort((a, b) => a.y - b.y);

  const connections = elementRegistry.filter((el: BpmnElement) => el.type === 'bpmn:SequenceFlow');

  for (const conn of connections) {
    if (!conn.source || !conn.target || !conn.waypoints || conn.waypoints.length < 2) continue;

    const srcLane = nodeToLane.get(conn.source.id);
    const tgtLane = nodeToLane.get(conn.target.id);

    // Only reroute cross-lane flows
    if (!srcLane || !tgtLane || srcLane.id === tgtLane.id) continue;

    const src = conn.source;
    const tgt = conn.target;
    const srcCy = src.y + (src.height || 0) / 2;
    const tgtCy = tgt.y + (tgt.height || 0) / 2;
    const srcRight = src.x + (src.width || 0);
    const tgtLeft = tgt.x;

    // Only handle forward flows (target to the right of source)
    if (tgtLeft <= srcRight) continue;

    // Determine which lanes are crossed (in top-to-bottom order)
    const srcLaneIdx = sortedLanes.findIndex((l) => l.id === srcLane.id);
    const tgtLaneIdx = sortedLanes.findIndex((l) => l.id === tgtLane.id);
    if (srcLaneIdx < 0 || tgtLaneIdx < 0) continue;

    const crossCount = Math.abs(tgtLaneIdx - srcLaneIdx);

    if (crossCount <= 1) {
      // Single lane crossing: simple Z-shape at the gap midpoint
      const midX = Math.round((srcRight + tgtLeft) / 2);
      const wps = [
        { x: Math.round(srcRight), y: Math.round(srcCy) },
        { x: midX, y: Math.round(srcCy) },
        { x: midX, y: Math.round(tgtCy) },
        { x: Math.round(tgtLeft), y: Math.round(tgtCy) },
      ];
      modeling.updateWaypoints(conn, deduplicateWaypoints(wps));
    } else {
      // Multi-lane crossing: build a staircase through each intermediate
      // lane boundary. Each "step" transitions vertically at an evenly
      // spaced X coordinate between source and target.
      const goingDown = tgtLaneIdx > srcLaneIdx;
      const startIdx = goingDown ? srcLaneIdx : tgtLaneIdx;
      const endIdx = goingDown ? tgtLaneIdx : srcLaneIdx;

      // Collect Y coordinates of lane boundaries we need to cross
      const boundaryYs: number[] = [];
      for (let i = startIdx; i < endIdx; i++) {
        const laneBottom = sortedLanes[i].y + sortedLanes[i].height;
        boundaryYs.push(laneBottom);
      }

      // If going up (target above source), reverse the boundaries
      if (!goingDown) boundaryYs.reverse();

      // Build staircase waypoints
      const wps: Array<{ x: number; y: number }> = [];
      const totalSteps = boundaryYs.length;
      let currentY = Math.round(srcCy);

      // Start: exit source horizontally
      wps.push({ x: Math.round(srcRight), y: currentY });

      for (let step = 0; step < totalSteps; step++) {
        // X position for this vertical transition: evenly spread between source and target
        const t = (step + 1) / (totalSteps + 1);
        const stepX = Math.round(srcRight + t * (tgtLeft - srcRight));

        // Horizontal segment to the step X
        wps.push({ x: stepX, y: currentY });

        // Vertical transition through the lane boundary
        currentY = Math.round(boundaryYs[step]);
        wps.push({ x: stepX, y: currentY });
      }

      // Final horizontal segment to target
      wps.push({ x: Math.round(tgtLeft), y: Math.round(tgtCy) });

      // Only apply if we have a valid route
      const cleaned = deduplicateWaypoints(wps);
      if (cleaned.length >= 2) {
        modeling.updateWaypoints(conn, cleaned);
      }
    }
  }
}
