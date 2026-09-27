/**
 * Shared geometry utilities for waypoint routing.
 *
 * Pure functions — no bpmn-js dependency, just math.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
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
