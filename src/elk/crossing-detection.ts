/**
 * Post-layout crossing flow detection and reduction.
 *
 * Checks all pairs of connections for segment intersections and reports
 * the count of crossing pairs along with their IDs.
 *
 * Also provides:
 * - Lane-crossing metrics: counts how many sequence flows cross lane
 *   boundaries within a participant pool.
 * - Crossing reduction: attempts to eliminate detected crossings by
 *   nudging waypoints on orthogonal edge segments.
 */

import type { CrossingFlowsResult, LaneCrossingMetrics } from './types';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { segmentsIntersect, segmentIntersectsRect, type Rect } from '../geometry';
import { isConnection } from './helpers';
import { deduplicateWaypoints } from './edge-routing-helpers';

/** Nudge offset in pixels when trying to separate crossing edges. */
const CROSSING_NUDGE_PX = 12;

/**
 * Maximum nudge multiplier (E6-3). We try 1× and 2× the base nudge offset.
 * Capped to stay within half the typical node spacing (~25px) to avoid
 * placing routes too close to adjacent elements.
 */
const NUDGE_MAX_MULTIPLIER = 2;

/**
 * BPMN flow-node types that connections should never route through (E6-4).
 * Container types (pools, lanes, expanded subprocesses) are excluded because
 * connections legitimately pass through their boundaries.
 */
const FLOW_NODE_TYPES = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:CallActivity',
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:BoundaryEvent',
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
]);

// ── H1: Orthogonal segment classification ──────────────────────────────────

/**
 * Maximum deviation (px) for a segment endpoint to still be classified as
 * horizontal (|dy| ≤ this) or vertical (|dx| ≤ this).  After the final
 * orthogonal snap pass, nearly all BPMN routes fall within this tolerance.
 * Remaining diagonal segments use the pairwise fallback.
 */
const ORTHO_CLASS_TOLERANCE = 3;

/** A horizontal segment (constant Y) extracted from a connection's waypoints. */
interface HOrthoSeg {
  y: number; // fixed Y coordinate (average of endpoints)
  x1: number; // left bound (min X)
  x2: number; // right bound (max X)
  connId: string;
}

/** A vertical segment (constant X) extracted from a connection's waypoints. */
interface VOrthoSeg {
  x: number; // fixed X coordinate (average of endpoints)
  y1: number; // top bound (min Y)
  y2: number; // bottom bound (max Y)
  connId: string;
}

/**
 * Classify every waypoint-segment in each connection as horizontal, vertical,
 * or general (diagonal / too short to matter).
 *
 * @returns hSegs - horizontal segments (sorted externally by caller)
 *          vSegs - vertical segments
 *          generalConnIds - connection IDs that have at least one diagonal segment
 */
function classifyConnectionSegments(connections: BpmnElement[]): {
  hSegs: HOrthoSeg[];
  vSegs: VOrthoSeg[];
  generalConnIds: Set<string>;
} {
  const hSegs: HOrthoSeg[] = [];
  const vSegs: VOrthoSeg[] = [];
  const generalConnIds = new Set<string>();

  for (const conn of connections) {
    const wps = conn.waypoints!;
    for (let i = 0; i < wps.length - 1; i++) {
      const p1 = wps[i];
      const p2 = wps[i + 1];
      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);

      if (dy <= ORTHO_CLASS_TOLERANCE && dx > ORTHO_CLASS_TOLERANCE) {
        // Horizontal segment
        hSegs.push({
          y: (p1.y + p2.y) / 2,
          x1: Math.min(p1.x, p2.x),
          x2: Math.max(p1.x, p2.x),
          connId: conn.id,
        });
      } else if (dx <= ORTHO_CLASS_TOLERANCE && dy > ORTHO_CLASS_TOLERANCE) {
        // Vertical segment
        vSegs.push({
          x: (p1.x + p2.x) / 2,
          y1: Math.min(p1.y, p2.y),
          y2: Math.max(p1.y, p2.y),
          connId: conn.id,
        });
      } else if (dx > ORTHO_CLASS_TOLERANCE || dy > ORTHO_CLASS_TOLERANCE) {
        // Non-trivial diagonal — needs pairwise fallback
        generalConnIds.add(conn.id);
      }
      // Very short segments (both dx and dy tiny) are irrelevant — skip
    }
  }

  return { hSegs, vSegs, generalConnIds };
}

/**
 * Binary search: first index in `arr` (sorted by `.y` ascending) where
 * `arr[i].y >= y`.  Returns `arr.length` if none.
 */
function lowerBoundY(arr: HOrthoSeg[], y: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].y < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Minimum interior margin (px) for the sweep-line crossing check.
 *
 * A V segment (x, [y1, y2]) and an H segment (y, [x1, x2]) are counted as
 * crossing only if the H segment's Y is **strictly interior** to the V's Y
 * range, and the V segment's X is **strictly interior** to the H's X range.
 *
 * This matches the strict cross-product test in `segmentsIntersect`, which
 * returns false when one segment's endpoint lies exactly on the other segment
 * (T-junction / endpoint touch).  For BPMN (integer coordinates after the
 * final orthogonal snap), 0.5 px cleanly separates endpoint touches from
 * genuine interior crossings.
 */
const SWEEP_INTERIOR_MARGIN = 0.5;

/**
 * Detect crossing sequence flows after layout.
 *
 * **H1 — O(n log n) sweep-line for orthogonal segments:**
 *
 * For orthogonal routing (segments are strictly horizontal or vertical),
 * a crossing can only occur between one H segment and one V segment —
 * two H segments are parallel and two V segments are parallel.
 *
 * Algorithm:
 * 1. Classify every waypoint-segment as H, V, or general (diagonal).
 * 2. Sort all H segments by Y.
 * 3. For each V segment (x, y1, y2): binary-search for H segments with
 *    y strictly in (y1, y2), then check whether the V segment's X falls
 *    strictly within the H segment's (x1, x2) range.  O(log n + k) per V.
 * 4. For connections that have any diagonal segment (rare after the final
 *    orthogonal snap), fall back to the original pairwise check.
 *
 * "Strictly interior" means we use SWEEP_INTERIOR_MARGIN to exclude
 * endpoint touches (T-junctions), matching the behaviour of
 * `segmentsIntersect` which uses the strict cross-product test.
 *
 * Total: O((n + k) log n) where n = total segments, k = crossing count.
 * For sparse crossings (typical BPMN) this is effectively O(n log n).
 */
export function detectCrossingFlows(elementRegistry: ElementRegistry): CrossingFlowsResult {
  const connections = elementRegistry.filter(
    (el) => isConnection(el.type) && !!el.waypoints && el.waypoints.length >= 2
  );

  if (connections.length === 0) return { count: 0, pairs: [] };

  const { hSegs, vSegs, generalConnIds } = classifyConnectionSegments(connections);

  // Sort H segments by Y so we can binary-search for each V segment's Y range
  hSegs.sort((a, b) => a.y - b.y);

  const crossingPairSet = new Set<string>();

  // Fast path: H × V sweep-line for orthogonal segments.
  // Uses SWEEP_INTERIOR_MARGIN to exclude endpoint touches (T-junctions),
  // matching the strict cross-product test used by `segmentsIntersect`.
  for (const vSeg of vSegs) {
    // Binary-search for first H seg with y strictly above vSeg.y1 (interior only)
    const lo = lowerBoundY(hSegs, vSeg.y1 + SWEEP_INTERIOR_MARGIN);
    for (let i = lo; i < hSegs.length; i++) {
      const hSeg = hSegs[i];
      // Stop when H segment's Y is no longer strictly below vSeg.y2
      if (hSeg.y >= vSeg.y2 - SWEEP_INTERIOR_MARGIN) break;
      if (hSeg.connId === vSeg.connId) continue; // Same connection — not a crossing
      // V's X must be strictly inside H's X range (not at either endpoint)
      if (hSeg.x1 + SWEEP_INTERIOR_MARGIN <= vSeg.x && vSeg.x <= hSeg.x2 - SWEEP_INTERIOR_MARGIN) {
        crossingPairSet.add(pairKey(hSeg.connId, vSeg.connId));
      }
    }
  }

  // Fallback: pairwise check for connections with diagonal segments
  if (generalConnIds.size > 0) {
    const genConns = connections.filter((c) => generalConnIds.has(c.id));
    for (const genConn of genConns) {
      for (const other of connections) {
        if (genConn.id === other.id) continue;
        const key = pairKey(genConn.id, other.id);
        if (crossingPairSet.has(key)) continue; // Already detected
        if (edgesCross(genConn, other)) {
          crossingPairSet.add(key);
        }
      }
    }
  }

  const pairs: Array<[string, string]> = Array.from(crossingPairSet).map((key) => {
    const sep = key.indexOf('|');
    return [key.slice(0, sep), key.slice(sep + 1)] as [string, string];
  });

  return { count: pairs.length, pairs };
}

// ── Crossing reduction ──────────────────────────────────────────────────────

/**
 * Attempt to reduce edge crossings by nudging waypoints on one of the
 * two crossing edges.
 *
 * Strategy: for each crossing pair, find the crossing segments and try
 * to shift one edge's intermediate vertical segment horizontally by
 * ±CROSSING_NUDGE_PX.  Accept the nudge only if it eliminates the
 * crossing without introducing new ones with other edges.
 *
 * This is a conservative local optimisation — it handles common cases
 * where two orthogonal routes cross at a shared column.  It does NOT
 * reorder ELK layers or move nodes.
 *
 * @returns The number of crossings eliminated.
 */
export function reduceCrossings(elementRegistry: ElementRegistry, modeling: Modeling): number {
  const connections = elementRegistry.filter(
    (el) => isConnection(el.type) && !!el.waypoints && el.waypoints.length >= 2
  );

  if (connections.length < 2) return 0;

  let eliminated = 0;

  // Build crossing index using the O(n log n) sweep-line algorithm (E6-1).
  // detectCrossingFlows() uses a fast H×V sweep instead of the O(n²)
  // pairwise edgesCross() loop, cutting detection cost significantly for
  // diagrams with many connections.
  const { pairs: detectedPairs } = detectCrossingFlows(elementRegistry);

  if (detectedPairs.length === 0) return 0;

  // E6-5: Multi-pair global pass — sort crossing pairs by combined impact.
  //
  // Impact = number of crossing pairs a connection participates in.
  // Processing the highest-impact connections first maximises the chance
  // that a single nudge resolves multiple crossings simultaneously, and
  // prevents a greedy fix for a low-impact pair from blocking a better
  // global fix for a high-impact connection.
  const impact = new Map<string, number>();
  for (const [a, b] of detectedPairs) {
    impact.set(a, (impact.get(a) ?? 0) + 1);
    impact.set(b, (impact.get(b) ?? 0) + 1);
  }

  // Sort pairs: highest combined impact first.  Stable sort preserves the
  // original sweep-line order for pairs with equal impact.
  const sortedPairs = [...detectedPairs].sort(
    ([a1, b1], [a2, b2]) =>
      (impact.get(a2) ?? 0) +
      (impact.get(b2) ?? 0) -
      ((impact.get(a1) ?? 0) + (impact.get(b1) ?? 0))
  );

  // Deduplicate while preserving sorted order (pairKey is symmetric).
  const seenPairs = new Set<string>();
  const orderedPairs: Array<[string, string]> = [];
  for (const [a, b] of sortedPairs) {
    const key = pairKey(a, b);
    if (!seenPairs.has(key)) {
      seenPairs.add(key);
      orderedPairs.push([a, b]);
    }
  }

  // E6-4: Collect flow-node shapes for element-overlap validation.
  // Only leaf nodes (tasks, events, gateways) are included — containers
  // (pools, lanes, subprocesses) are excluded because connections
  // legitimately cross their boundaries.
  const shapes = elementRegistry.filter(
    (el) => FLOW_NODE_TYPES.has(el.type) && !!el.width && !!el.height
  );

  // Try to fix each crossing pair in impact-sorted order
  for (const [idA, idB] of orderedPairs) {
    const connA = elementRegistry.get(idA);
    const connB = elementRegistry.get(idB);
    if (!connA?.waypoints || !connB?.waypoints) continue;

    // Skip if the crossing was already eliminated by a previous fix
    if (!edgesCross(connA, connB)) {
      eliminated++;
      continue;
    }

    // Try nudging connB's internal vertical segments
    if (tryNudgeToAvoidCrossing(connB, connA, connections, modeling, shapes)) {
      eliminated++;
      continue;
    }
    // Try nudging connA's internal vertical segments
    if (tryNudgeToAvoidCrossing(connA, connB, connections, modeling, shapes)) {
      eliminated++;
    }
  }

  return eliminated;
}

/** Canonical key for a pair of connection IDs. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Check whether two connections have any crossing segments. */
function edgesCross(a: BpmnElement, b: BpmnElement): boolean {
  const wpsA = a.waypoints!;
  const wpsB = b.waypoints!;
  for (let i = 0; i < wpsA.length - 1; i++) {
    for (let j = 0; j < wpsB.length - 1; j++) {
      if (segmentsIntersect(wpsA[i], wpsA[i + 1], wpsB[j], wpsB[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Count how many of `allConnections` would cross with `conn` if its
 * waypoints were `candidateWps`.
 */
function countCrossingsWithCandidate(
  candidateWps: Array<{ x: number; y: number }>,
  allConnections: BpmnElement[],
  skipId: string
): number {
  let count = 0;
  for (const other of allConnections) {
    if (other.id === skipId || !other.waypoints) continue;
    const wpsB = other.waypoints;
    let found = false;
    for (let i = 0; i < candidateWps.length - 1 && !found; i++) {
      for (let j = 0; j < wpsB.length - 1 && !found; j++) {
        if (segmentsIntersect(candidateWps[i], candidateWps[i + 1], wpsB[j], wpsB[j + 1])) {
          found = true;
        }
      }
    }
    if (found) count++;
  }
  return count;
}

/**
 * Check whether any purely-internal segment of `candidate` (i.e. not the
 * first or last endpoint segment) passes through a flow-node shape (E6-4).
 *
 * The first segment (0→1) and last segment (n-2→n-1) are skipped because
 * they connect to source/target element perimeters and may appear to "enter"
 * those shapes from the outside — this is expected bpmn-js behaviour.
 * Only the interior segments (1→2, 2→3, …, n-3→n-2) are checked.
 */
function nudgeRouteOverlapsShape(
  candidate: Array<{ x: number; y: number }>,
  shapes: BpmnElement[]
): boolean {
  // Need at least 4 waypoints to have a purely-internal segment
  if (candidate.length < 4 || shapes.length === 0) return false;

  for (let i = 1; i < candidate.length - 2; i++) {
    const p1 = candidate[i];
    const p2 = candidate[i + 1];
    for (const shape of shapes) {
      if (!shape.width || !shape.height) continue;
      const rect: Rect = { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      if (segmentIntersectsRect(p1, p2, rect)) return true;
    }
  }
  return false;
}

/**
 * Try to nudge internal vertical segments of `toNudge` so it no longer
 * crosses `crossingWith`.  Only accepts changes that do not increase the
 * total crossing count for `toNudge`, and rejects nudges that route
 * through flow-node shape bounding boxes (E6-4).
 *
 * E6-3: Tries nudge offsets at 1× and 2× `CROSSING_NUDGE_PX` before
 * giving up, providing more opportunities to escape tight crossings.
 *
 * @returns true if a successful nudge was applied.
 */
function tryNudgeToAvoidCrossing(
  toNudge: BpmnElement,
  crossingWith: BpmnElement,
  allConnections: BpmnElement[],
  modeling: Modeling,
  shapes: BpmnElement[]
): boolean {
  const wps = toNudge.waypoints!;
  if (wps.length < 3) return false; // Need at least one internal segment

  const currentCrossings = countCrossingsWithCandidate(
    wps.map((w) => ({ x: w.x, y: w.y })),
    allConnections,
    toNudge.id
  );

  // Try nudging each internal vertical segment
  for (let i = 1; i < wps.length - 1; i++) {
    // An internal point is part of a vertical segment if its X differs
    // from a neighbour by < 2px (near-vertical in orthogonal routes).
    const prevIsVert = Math.abs(wps[i - 1].x - wps[i].x) < 2;
    const nextIsVert = i < wps.length - 1 && Math.abs(wps[i].x - wps[i + 1].x) < 2;

    if (!prevIsVert && !nextIsVert) continue;

    // E6-3: Adaptive offsets — try 1× then 2× the base nudge distance
    for (let mult = 1; mult <= NUDGE_MAX_MULTIPLIER; mult++) {
      for (const sign of [-1, 1]) {
        const dx = sign * mult * CROSSING_NUDGE_PX;
        const candidate = wps.map((w) => ({ x: w.x, y: w.y }));

        // Nudge the vertical run: shift all consecutive points sharing
        // the same X as wps[i].
        const baseX = wps[i].x;
        for (let k = 1; k < candidate.length - 1; k++) {
          if (Math.abs(candidate[k].x - baseX) < 2) {
            candidate[k] = { x: candidate[k].x + dx, y: candidate[k].y };
          }
        }

        // Check: does the nudge eliminate the target crossing?
        let stillCrosses = false;
        const wpsB = crossingWith.waypoints!;
        for (let a = 0; a < candidate.length - 1 && !stillCrosses; a++) {
          for (let b = 0; b < wpsB.length - 1 && !stillCrosses; b++) {
            if (segmentsIntersect(candidate[a], candidate[a + 1], wpsB[b], wpsB[b + 1])) {
              stillCrosses = true;
            }
          }
        }
        if (stillCrosses) continue;

        // Check: did we create more crossings overall?
        const newCrossings = countCrossingsWithCandidate(candidate, allConnections, toNudge.id);
        if (newCrossings >= currentCrossings) continue;

        // E6-4: Reject nudges that route through a flow-node shape bounding box
        if (nudgeRouteOverlapsShape(candidate, shapes)) continue;

        // Accept the nudge
        modeling.updateWaypoints(toNudge, deduplicateWaypoints(candidate));
        return true;
      }
    }
  }

  // Try nudging each internal horizontal segment vertically (E6-2).
  // Symmetric to the vertical-segment case above: when two horizontal
  // runs share the same Y, nudging one up or down by CROSSING_NUDGE_PX
  // can eliminate a horizontal-overlap crossing.
  for (let i = 1; i < wps.length - 1; i++) {
    // An internal point is part of a horizontal segment if its Y differs
    // from a neighbour by < 2px (near-horizontal in orthogonal routes).
    const prevIsHoriz = Math.abs(wps[i - 1].y - wps[i].y) < 2;
    const nextIsHoriz = i < wps.length - 1 && Math.abs(wps[i].y - wps[i + 1].y) < 2;

    if (!prevIsHoriz && !nextIsHoriz) continue;

    // E6-3: Adaptive offsets — try 1× then 2× the base nudge distance
    for (let mult = 1; mult <= NUDGE_MAX_MULTIPLIER; mult++) {
      for (const sign of [-1, 1]) {
        const dy = sign * mult * CROSSING_NUDGE_PX;
        const candidate = wps.map((w) => ({ x: w.x, y: w.y }));

        // Nudge the horizontal run: shift all consecutive points sharing
        // the same Y as wps[i].
        const baseY = wps[i].y;
        for (let k = 1; k < candidate.length - 1; k++) {
          if (Math.abs(candidate[k].y - baseY) < 2) {
            candidate[k] = { x: candidate[k].x, y: candidate[k].y + dy };
          }
        }

        // Check: does the nudge eliminate the target crossing?
        let stillCrosses = false;
        const wpsB = crossingWith.waypoints!;
        for (let a = 0; a < candidate.length - 1 && !stillCrosses; a++) {
          for (let b = 0; b < wpsB.length - 1 && !stillCrosses; b++) {
            if (segmentsIntersect(candidate[a], candidate[a + 1], wpsB[b], wpsB[b + 1])) {
              stillCrosses = true;
            }
          }
        }
        if (stillCrosses) continue;

        // Check: did we create more crossings overall?
        const newCrossings = countCrossingsWithCandidate(candidate, allConnections, toNudge.id);
        if (newCrossings >= currentCrossings) continue;

        // E6-4: Reject nudges that route through a flow-node shape bounding box
        if (nudgeRouteOverlapsShape(candidate, shapes)) continue;

        // Accept the nudge
        modeling.updateWaypoints(toNudge, deduplicateWaypoints(candidate));
        return true;
      }
    }
  }

  return false;
}

/**
 * Compute lane-crossing metrics for a diagram.
 *
 * Counts how many sequence flows cross lane boundaries within
 * participant pools. A "lane crossing" occurs when a sequence flow
 * connects two elements assigned to different lanes.
 *
 * Returns overall statistics and per-lane details.
 */
export function computeLaneCrossingMetrics(
  elementRegistry: ElementRegistry
): LaneCrossingMetrics | undefined {
  const lanes = elementRegistry.filter((el: BpmnElement) => el.type === 'bpmn:Lane');
  if (lanes.length === 0) return undefined;

  // Build element → lane mapping
  const elementToLane = new Map<string, string>();
  for (const lane of lanes) {
    const bo = lane.businessObject;
    const refs = (bo?.flowNodeRef || []) as Array<{ id: string }>;
    for (const ref of refs) {
      elementToLane.set(ref.id, lane.id);
    }
  }

  // Count sequence flows that cross lanes
  const sequenceFlows = elementRegistry.filter(
    (el: BpmnElement) => el.type === 'bpmn:SequenceFlow' && !!el.source && !!el.target
  );

  let totalFlows = 0;
  let crossingFlows = 0;
  const crossingFlowIds: string[] = [];

  for (const flow of sequenceFlows) {
    const sourceLane = elementToLane.get(flow.source!.id);
    const targetLane = elementToLane.get(flow.target!.id);

    // Only count flows where both source and target are in lanes
    if (sourceLane !== undefined && targetLane !== undefined) {
      totalFlows++;
      if (sourceLane !== targetLane) {
        crossingFlows++;
        crossingFlowIds.push(flow.id);
      }
    }
  }

  if (totalFlows === 0) return undefined;

  const coherenceScore = Math.round(((totalFlows - crossingFlows) / totalFlows) * 100);

  return {
    totalLaneFlows: totalFlows,
    crossingLaneFlows: crossingFlows,
    crossingFlowIds: crossingFlowIds.length > 0 ? crossingFlowIds : undefined,
    laneCoherenceScore: coherenceScore,
  };
}
