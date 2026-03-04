/**
 * Shared waypoint utilities for the rebuild layout engine.
 *
 * Extracted to a separate module so both `engine.ts` and `lane-layout.ts`
 * can import without creating a circular dependency (engine.ts imports
 * lane-layout.ts, so lane-layout.ts cannot import engine.ts).
 */

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
  if (Math.abs(sourceMidY - targetMidY) <= sourceHalfHeight + 20) return false;

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
 */
function assignLShapeWaypoints(
  conn: any,
  sourceRight: number,
  targetLeft: number,
  sourceMidY: number,
  targetMidY: number
): void {
  const midX = Math.round((sourceRight + targetLeft) / 2);
  if (Math.abs(sourceMidY - targetMidY) <= 1) {
    conn.waypoints = [
      { x: sourceRight, y: sourceMidY, original: { x: sourceRight, y: sourceMidY } },
      { x: targetLeft, y: targetMidY, original: { x: targetLeft, y: targetMidY } },
    ];
  } else {
    conn.waypoints = [
      { x: sourceRight, y: sourceMidY, original: { x: sourceRight, y: sourceMidY } },
      { x: midX, y: sourceMidY },
      { x: midX, y: targetMidY },
      { x: targetLeft, y: targetMidY, original: { x: targetLeft, y: targetMidY } },
    ];
  }
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

  assignLShapeWaypoints(conn, sourceRight, targetLeft, sourceMidY, targetMidY);
}
