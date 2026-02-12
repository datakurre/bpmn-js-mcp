/**
 * Shared helpers for edge-routing modules.
 *
 * Extracts common patterns used across edge routing, simplification,
 * and repair passes to reduce duplication.
 */

// ── Waypoint deduplication ─────────────────────────────────────────────────

/**
 * Remove consecutive duplicate waypoints from an array.
 *
 * Two consecutive points are considered duplicates when both their X and Y
 * coordinates are within `tolerance` pixels of each other.
 *
 * @param wps      Array of waypoints to deduplicate.
 * @param tolerance Maximum pixel distance on each axis to consider equal (default 1).
 * @returns New array with consecutive duplicates removed.
 */
export function deduplicateWaypoints(
  wps: ReadonlyArray<{ x: number; y: number }>,
  tolerance = 1
): Array<{ x: number; y: number }> {
  if (wps.length === 0) return [];
  const result = [wps[0]];
  for (let i = 1; i < wps.length; i++) {
    const prev = result[result.length - 1];
    if (Math.abs(prev.x - wps[i].x) > tolerance || Math.abs(prev.y - wps[i].y) > tolerance) {
      result.push(wps[i]);
    }
  }
  return result;
}

// ── Z-shape route construction ─────────────────────────────────────────────

/**
 * Build a 4-waypoint Z-shaped route between two elements.
 *
 * The route goes: source right edge → horizontal to midpoint →
 * vertical to target row → horizontal to target left edge.
 *
 * ```
 *  src ──→ midX
 *            │
 *          midX ──→ tgt
 * ```
 *
 * @param srcRight  X coordinate of the source element's right edge.
 * @param srcCy     Y coordinate of the source element's centre.
 * @param tgtLeft   X coordinate of the target element's left edge.
 * @param tgtCy     Y coordinate of the target element's centre.
 * @returns 4-waypoint array forming a Z-shape.
 */
export function buildZShapeRoute(
  srcRight: number,
  srcCy: number,
  tgtLeft: number,
  tgtCy: number
): Array<{ x: number; y: number }> {
  const midX = Math.round((srcRight + tgtLeft) / 2);
  return [
    { x: Math.round(srcRight), y: Math.round(srcCy) },
    { x: midX, y: Math.round(srcCy) },
    { x: midX, y: Math.round(tgtCy) },
    { x: Math.round(tgtLeft), y: Math.round(tgtCy) },
  ];
}
