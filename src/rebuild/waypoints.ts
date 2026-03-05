/**
 * Shared waypoint utilities for the rebuild layout engine.
 *
 * Extracted to a separate module so both `engine.ts` and `lane-layout.ts`
 * can import without creating a circular dependency (engine.ts imports
 * lane-layout.ts, so lane-layout.ts cannot import engine.ts).
 */

import { segmentIntersectsRect } from '../geometry';

// ── Types ──────────────────────────────────────────────────────────────────

/** Axis-aligned bounding box (left-top origin, positive width/height). */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Obstruction detection ──────────────────────────────────────────────────

/**
 * Element types that should NOT be treated as obstructions when routing
 * connections.  Flows, labels, and data-associations are transparent
 * (they are connections themselves or decorators, not solid shapes).
 */
const NON_OBSTRUCTION_TYPES = new Set([
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Association',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
  'label',
]);

/**
 * Collect bounding boxes of sibling elements in the same parent container,
 * excluding the source and target of the connection.
 *
 * Accesses siblings via `conn.source.parent.children`, which bpmn-js keeps
 * current.  Returns an empty array when parent or children are unavailable.
 */
function getSiblingBounds(conn: any): Rect[] {
  const source = conn.source;
  const parent = source?.parent;
  if (!parent?.children) return [];

  const sourceId = source?.id;
  const targetId = conn.target?.id;

  const bounds: Rect[] = [];
  for (const el of parent.children) {
    if (el.id === sourceId || el.id === targetId) continue;
    if (NON_OBSTRUCTION_TYPES.has(el.type)) continue;
    if (el.x === undefined || el.y === undefined || !el.width || !el.height) continue;
    bounds.push({ x: el.x, y: el.y, width: el.width, height: el.height });
  }
  return bounds;
}

/**
 * Gap (px) added between a detected obstruction boundary and the detour path.
 * Keeps the U-shape from grazing the element edge.
 */
const OBSTRUCTION_DETOUR_GAP = 20;

/**
 * Same-Y tolerance (px) for treating two element centre-Y values as identical.
 *
 * Zero drift is expected in headless mode (no bpmn-js grid snap on programmatic
 * moves), but a small safety margin guards against floating-point rounding in
 * intermediate position computations and any future UI-driven moves where the
 * 10px top-left snap can shift gateway centres by up to 5px.
 */
export const SAME_Y_TOLERANCE = 5;

/**
 * Shrink factor applied to element bounding boxes when testing for path
 * intersections.  Prevents false positives from elements that barely touch
 * the path at shared edges (e.g. source/target neighbours).
 */
const OBSTRUCTION_SHRINK = 2;

/**
 * Check whether any segment of the L-shape path intersects an element bounding
 * box from `siblingBounds`.  Bounding boxes are shrunk by `OBSTRUCTION_SHRINK`
 * px on all sides to avoid false positives at shared-edge contacts.
 *
 * The L-shape path:
 *   For different-Y: (sourceRight, sourceMidY) → (midX, sourceMidY) →
 *                    (midX, targetMidY) → (targetLeft, targetMidY)
 *   For same-Y:      (sourceRight, sourceMidY) → (targetLeft, targetMidY)
 */
function findLShapeObstructions(
  sourceRight: number,
  targetLeft: number,
  sourceMidY: number,
  targetMidY: number,
  midX: number,
  siblingBounds: Rect[]
): { minY: number; maxY: number } | null {
  if (siblingBounds.length === 0) return null;

  let minY = Infinity;
  let maxY = -Infinity;
  let blocked = false;

  for (const bounds of siblingBounds) {
    const rect: Rect = {
      x: bounds.x + OBSTRUCTION_SHRINK,
      y: bounds.y + OBSTRUCTION_SHRINK,
      width: bounds.width - OBSTRUCTION_SHRINK * 2,
      height: bounds.height - OBSTRUCTION_SHRINK * 2,
    };
    if (rect.width <= 0 || rect.height <= 0) continue;

    // Same-Y connection uses a 2-point straight path; no midX turn.
    const isSameY = Math.abs(sourceMidY - targetMidY) <= SAME_Y_TOLERANCE;
    const intersects = isSameY
      ? segmentIntersectsRect(
          { x: sourceRight, y: sourceMidY },
          { x: targetLeft, y: targetMidY },
          rect
        )
      : segmentIntersectsRect(
          { x: sourceRight, y: sourceMidY },
          { x: midX, y: sourceMidY },
          rect
        ) ||
        segmentIntersectsRect({ x: midX, y: sourceMidY }, { x: midX, y: targetMidY }, rect) ||
        segmentIntersectsRect({ x: midX, y: targetMidY }, { x: targetLeft, y: targetMidY }, rect);

    if (intersects) {
      minY = Math.min(minY, bounds.y);
      maxY = Math.max(maxY, bounds.y + bounds.height);
      blocked = true;
    }
  }

  return blocked ? { minY, maxY } : null;
}

// ── Sub-functions ──────────────────────────────────────────────────────────

/**
 * Apply gateway fan-out waypoints: 3-point V→H path from gateway to a
 * target that is significantly above or below the gateway centre.
 * Returns true if waypoints were applied (fan-out pattern detected).
 *
 * The threshold for "significant offset" is `sourceHalfHeight + 20`.
 * Raising from the bare `sourceHalfHeight` (25px for a 50px gateway) to
 * `sourceHalfHeight + 20` (= 45px) prevents the V→H pattern from being
 * applied to near-horizontal connections (offset ≤ 45px), which look
 * cleaner as a straight or L-shaped 2/4-point path.
 */
function applyGatewayFanoutReset(
  conn: any,
  source: any,
  sourceMidY: number,
  targetMidY: number,
  targetLeft: number,
  sourceHalfHeight: number
): boolean {
  if (Math.abs(sourceMidY - targetMidY) <= sourceHalfHeight) return false;

  const sourceMidX = source.x + (source.width || 0) / 2;
  const exitY = targetMidY < sourceMidY ? source.y : source.y + (source.height || 0);
  conn.waypoints = [
    { x: sourceMidX, y: exitY, original: { x: sourceMidX, y: exitY } },
    { x: sourceMidX, y: targetMidY },
    { x: targetLeft, y: targetMidY, original: { x: targetLeft, y: targetMidY } },
  ];
  return true;
}

/**
 * Detect whether a connection's waypoints are stale (require reset).
 *
 * Runs five checks:
 * 1. Backward detour — intermediate waypoints go left of source left edge.
 * 2. Same-Y vertical detour — waypoints escape the source/target Y band.
 * 3. Vertical escape — intermediate points exceed ±50px outside Y range.
 * 4. Wrong-exit direction — first waypoint is at source centre-X (top/bottom exit).
 * 5. Wrong-Y right-edge docking — first waypoint at right edge but off-centre Y.
 */
function detectStaleRouting(
  wps: any[],
  source: any,
  target: any,
  sourceMidY: number,
  targetMidY: number,
  sourceRight: number
): boolean {
  // Check 1: backward detour
  if (wps.length >= 3) {
    const hasBackward = wps.slice(1, -1).some((wp: any) => wp.x < source.x - 5);
    if (hasBackward) return true;
  }

  // Check 2: same-Y vertical detour
  if (Math.abs(sourceMidY - targetMidY) <= 10) {
    const bTop = Math.min(source.y, target.y);
    const bBot = Math.max(source.y + (source.height || 0), target.y + (target.height || 0));
    if (wps.some((wp: any) => wp.y < bTop - 5 || wp.y > bBot + 5)) return true;
  }

  // Check 3: vertical escape (>50px outside Y range)
  if (wps.length >= 3) {
    const yTop = Math.min(source.y, target.y);
    const yBot = Math.max(source.y + (source.height || 0), target.y + (target.height || 0));
    if (wps.slice(1, -1).some((wp: any) => wp.y < yTop - 50 || wp.y > yBot + 50)) return true;
  }

  // Check 4: wrong-exit direction — first waypoint near source centre-X
  const srcCenterX = source.x + (source.width || 0) / 2;
  if (Math.abs(wps[0].x - srcCenterX) < (source.width || 80) * 0.3) return true;

  // Check 5: wrong-Y right-edge docking — first waypoint at right edge but off-centre Y
  if (wps.length >= 2) {
    const srcCenterY = source.y + (source.height || 0) / 2;
    if (Math.abs(wps[0].x - sourceRight) <= 3) {
      const segDx = Math.abs(wps[1].x - wps[0].x);
      const segDy = Math.abs(wps[1].y - wps[0].y);
      if (segDy > segDx * 2 && Math.abs(wps[0].y - srcCenterY) > 20) return true;
    }
  }

  return false;
}

/**
 * Assign a clean L-shaped (orthogonal) waypoint path to the connection.
 * Uses a 2-point straight path for same-Y connections, 4-point L-shape otherwise.
 *
 * When `siblingBounds` is provided, checks whether the L-shape intermediate
 * segments would cross through any sibling element.  If blocked, routes via
 * a U-shape detour that goes above or below the obstructing element(s).
 */
function assignLShapeWaypoints(
  conn: any,
  sourceRight: number,
  targetLeft: number,
  sourceMidY: number,
  targetMidY: number,
  siblingBounds?: Rect[]
): void {
  const midX = Math.round((sourceRight + targetLeft) / 2);
  if (Math.abs(sourceMidY - targetMidY) <= SAME_Y_TOLERANCE) {
    conn.waypoints = [
      { x: sourceRight, y: sourceMidY, original: { x: sourceRight, y: sourceMidY } },
      { x: targetLeft, y: targetMidY, original: { x: targetLeft, y: targetMidY } },
    ];
    return;
  }

  // Check for obstructions if sibling bounds are available
  if (siblingBounds && siblingBounds.length > 0) {
    const blocked = findLShapeObstructions(
      sourceRight,
      targetLeft,
      sourceMidY,
      targetMidY,
      midX,
      siblingBounds
    );

    if (blocked) {
      // Route via U-shape to avoid the obstruction.
      // Choose above or below based on which requires less Y deviation.
      const detourBelow = blocked.maxY + OBSTRUCTION_DETOUR_GAP;
      const detourAbove = blocked.minY - OBSTRUCTION_DETOUR_GAP;
      const avgY = (sourceMidY + targetMidY) / 2;
      const detourY =
        Math.abs(detourBelow - avgY) <= Math.abs(detourAbove - avgY) ? detourBelow : detourAbove;

      // U-shape: exit source right → go to detourY → traverse to targetLeft → enter target
      conn.waypoints = [
        { x: sourceRight, y: sourceMidY, original: { x: sourceRight, y: sourceMidY } },
        { x: sourceRight, y: detourY },
        { x: targetLeft, y: detourY },
        { x: targetLeft, y: targetMidY, original: { x: targetLeft, y: targetMidY } },
      ];
      return;
    }
  }

  // Standard L-shape (no obstruction)
  conn.waypoints = [
    { x: sourceRight, y: sourceMidY, original: { x: sourceRight, y: sourceMidY } },
    { x: midX, y: sourceMidY },
    { x: midX, y: targetMidY },
    { x: targetLeft, y: targetMidY, original: { x: targetLeft, y: targetMidY } },
  ];
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Reset a connection's waypoints to edge-to-edge so that ManhattanLayout
 * computes fresh routing based on current element positions rather than
 * being influenced by stale waypoints from intermediate moves.
 *
 * Only applies to left-to-right connections (target is to the right of
 * source).  For gateway sources with vertically offset targets the
 * waypoints are always set to a V→H fan-out path.  For other sources
 * the five detection checks in `detectStaleRouting` decide whether a
 * reset is needed.
 *
 * When sibling elements share a parent container with the source, checks
 * whether the candidate L-shape path would cross through any of them.
 * If blocked, routes via a U-shape detour above or below the obstruction.
 */
export function resetStaleWaypoints(conn: any): void {
  const source = conn.source;
  const target = conn.target;
  if (!source || !target) return;

  const wps = conn.waypoints;
  if (!wps || wps.length === 0) return;

  const sourceRight = source.x + (source.width || 0);
  const targetLeft = target.x;

  // Only applies to left-to-right connections (target is to the right)
  if (targetLeft <= sourceRight) return;

  const sourceMidY = source.y + (source.height || 0) / 2;
  const targetMidY = target.y + (target.height || 0) / 2;
  const sourceHalfHeight = (source.height || 0) / 2;

  // Gateway fan-out: always reset for sufficiently offset targets
  if (source.type?.includes('Gateway')) {
    if (
      applyGatewayFanoutReset(conn, source, sourceMidY, targetMidY, targetLeft, sourceHalfHeight)
    ) {
      return;
    }
  }

  if (wps.length < 2) return;

  if (!detectStaleRouting(wps, source, target, sourceMidY, targetMidY, sourceRight)) return;

  // Collect sibling element bounds for obstruction-aware routing
  const siblingBounds = getSiblingBounds(conn);

  assignLShapeWaypoints(conn, sourceRight, targetLeft, sourceMidY, targetMidY, siblingBounds);
}

// ── Post-layout straightening ──────────────────────────────────────────────

/**
 * Check whether all segments of a waypoint path are orthogonal.
 *
 * A segment is orthogonal when it is strictly horizontal (dy < 1 px) or
 * strictly vertical (dx < 1 px).  Diagonal segments — where both dx and dy
 * are ≥ 1 px — indicate a non-orthogonal (Z-shaped or skewed) path.
 */
export function isFullyOrthogonal(wps: Array<{ x: number; y: number }>): boolean {
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    if (dx >= 1 && dy >= 1) return false; // diagonal segment
  }
  return true;
}

/**
 * Post-layout pass: straighten non-orthogonal forward sequence flows.
 *
 * After `modeling.layoutConnection()` runs during rebuild, ManhattanLayout may
 * still produce Z-shaped or diagonal waypoints on connections where the source
 * and target have a slight Y drift (e.g. gateways shifted by grid snap in
 * UI mode, or floating-point rounding in complex lane layouts).
 *
 * This pass scans all provided connections and replaces any non-orthogonal
 * forward (left-to-right) sequence flow with a clean L-shape or 2-point
 * straight path via `assignLShapeWaypoints`.
 *
 * **Scope:**
 * - Only `bpmn:SequenceFlow` connections are considered.
 * - Only forward (left-to-right) flows: `target.x > source.x + source.width`.
 * - Back-edge loop-back connections are skipped (handled by `applyAllBackEdgeUShapes`).
 * - MessageFlow and Association connections are skipped.
 * - Already-orthogonal connections are skipped (no-op for clean diagrams).
 *
 * Mutates `conn.waypoints` directly — call `syncXml` afterwards to persist.
 *
 * @param allConnections  All elements from `elementRegistry.getAll()`.
 * @returns Number of connections whose waypoints were replaced.
 */
export function straightenNonOrthogonalFlows(allConnections: any[]): number {
  let count = 0;

  for (const conn of allConnections) {
    if (conn.type !== 'bpmn:SequenceFlow') continue;

    const source = conn.source;
    const target = conn.target;
    if (!source || !target) continue;

    const sourceRight = source.x + (source.width ?? 0);
    const targetLeft = target.x;

    // Only forward (left-to-right) connections; skip back-edges and self-loops
    if (targetLeft <= sourceRight) continue;

    const wps: Array<{ x: number; y: number }> = conn.waypoints;
    if (!wps || wps.length < 2) continue;

    // Already fully orthogonal — leave it alone
    if (isFullyOrthogonal(wps)) continue;

    const sourceMidY = source.y + (source.height ?? 0) / 2;
    const targetMidY = target.y + (target.height ?? 0) / 2;
    const siblingBounds = getSiblingBounds(conn);

    assignLShapeWaypoints(conn, sourceRight, targetLeft, sourceMidY, targetMidY, siblingBounds);
    count++;
  }

  return count;
}
