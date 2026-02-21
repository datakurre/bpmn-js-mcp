/**
 * Shared helpers for edge-routing modules.
 *
 * Extracts common patterns used across edge routing, simplification,
 * and repair passes to reduce duplication.
 */

// ── Waypoint deduplication ─────────────────────────────────────────────────

/**
 * Remove consecutive duplicate waypoints from an array and collapse
 * backtracking oscillations (A→B→A→B → A).
 *
 * Two consecutive points are considered duplicates when both their X and Y
 * coordinates are within `tolerance` pixels of each other.
 *
 * Additionally, after removing consecutive duplicates a second pass collapses
 * oscillating sub-sequences where the path reverses direction and returns to
 * a previously-visited coordinate: …→P→Q→P→… is shortened to …→P→….
 * This handles the common failure mode where element-avoidance detours or
 * crossing-reduction nudges repeatedly visit the same two waypoints before
 * finally continuing toward the target.
 *
 * @param wps      Array of waypoints to deduplicate.
 * @param tolerance Maximum pixel distance on each axis to consider equal (default 1).
 * @returns New array with consecutive duplicates and oscillations removed.
 */
export function deduplicateWaypoints(
  wps: ReadonlyArray<{ x: number; y: number }>,
  tolerance = 1
): Array<{ x: number; y: number }> {
  if (wps.length === 0) return [];

  // Pass 1: remove consecutive duplicates
  const pass1: Array<{ x: number; y: number }> = [wps[0]];
  for (let i = 1; i < wps.length; i++) {
    const prev = pass1[pass1.length - 1];
    if (Math.abs(prev.x - wps[i].x) > tolerance || Math.abs(prev.y - wps[i].y) > tolerance) {
      pass1.push(wps[i]);
    }
  }

  if (pass1.length <= 2) return pass1;

  // Pass 2: collapse backtracking oscillations (A→B→A→… → A→…).
  // Repeatedly scan until no more collapses are possible, capped at a fixed
  // number of iterations to guarantee termination even for degenerate input.
  let current = pass1;
  for (let iter = 0; iter < 20; iter++) {
    let changed = false;
    const next: Array<{ x: number; y: number }> = [current[0]];

    for (let i = 1; i < current.length; i++) {
      const pt = current[i];
      // Check if pt matches the second-to-last accepted point (i.e. the
      // path has gone A → B → A).  If so, discard both B and the repeated A
      // by popping B from next — the next push restores A in its place.
      if (next.length >= 2) {
        const beforePrev = next[next.length - 2];
        if (
          Math.abs(beforePrev.x - pt.x) <= tolerance &&
          Math.abs(beforePrev.y - pt.y) <= tolerance
        ) {
          // Pop the intermediate point B; the loop will push A (pt) below.
          next.pop();
          changed = true;
        }
      }
      next.push(pt);
    }

    current = next;
    if (!changed) break;
  }

  return current;
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
