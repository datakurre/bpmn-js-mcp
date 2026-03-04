/**
 * Shared geometry utilities for bounding-box overlap detection,
 * segment intersection tests, and waypoint manipulation.
 *
 * Pure functions — no bpmn-js dependency, just math.
 *
 * Extracted from overlap-resolution, crossing-detection,
 * handlers/layout/labels/label-utils, and bpmnlint-plugin rules
 * to eliminate cross-module duplication.
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

// ── Bounding-box overlap ───────────────────────────────────────────────────

/** Check if two axis-aligned rectangles overlap. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Check if two axis-aligned rectangles are within `margin` pixels of each other.
 * Returns true if the rects overlap OR the gap between them is ≤ margin.
 */
export function rectsNearby(a: Rect, b: Rect, margin: number): boolean {
  return (
    a.x - margin < b.x + b.width &&
    a.x + a.width + margin > b.x &&
    a.y - margin < b.y + b.height &&
    a.y + a.height + margin > b.y
  );
}

/**
 * Check if rect `outer` fully contains rect `inner`.
 * Returns true when every edge of `inner` is within the bounds of `outer`.
 * Used to detect parent-child container relationships — a subprocess element
 * overlapping its parent subprocess is not a layout defect.
 */
export function rectsContains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

// ── Line segment ↔ rectangle intersection ──────────────────────────────────

/**
 * Cohen-Sutherland outcodes for a point relative to a rectangle.
 */
function outcode(px: number, py: number, rect: Rect): number {
  let code = 0;
  if (px < rect.x) {
    code |= 1; // LEFT
  } else if (px > rect.x + rect.width) {
    code |= 2; // RIGHT
  }
  if (py < rect.y) {
    code |= 4; // TOP
  } else if (py > rect.y + rect.height) {
    code |= 8; // BOTTOM
  }
  return code;
}

/**
 * Test whether line segment (p1→p2) intersects an axis-aligned rectangle.
 * Uses the Cohen-Sutherland algorithm.
 */
export function segmentIntersectsRect(p1: Point, p2: Point, rect: Rect): boolean {
  let x0 = p1.x,
    y0 = p1.y,
    x1 = p2.x,
    y1 = p2.y;
  let code0 = outcode(x0, y0, rect);
  let code1 = outcode(x1, y1, rect);

  for (;;) {
    if ((code0 | code1) === 0) return true; // both inside
    if ((code0 & code1) !== 0) return false; // both outside same side

    const codeOut = code0 !== 0 ? code0 : code1;
    let x = 0,
      y = 0;
    const xMin = rect.x,
      xMax = rect.x + rect.width;
    const yMin = rect.y,
      yMax = rect.y + rect.height;

    if (codeOut & 8) {
      // BOTTOM
      x = x0 + ((x1 - x0) * (yMax - y0)) / (y1 - y0);
      y = yMax;
    } else if (codeOut & 4) {
      // TOP
      x = x0 + ((x1 - x0) * (yMin - y0)) / (y1 - y0);
      y = yMin;
    } else if (codeOut & 2) {
      // RIGHT
      y = y0 + ((y1 - y0) * (xMax - x0)) / (x1 - x0);
      x = xMax;
    } else if (codeOut & 1) {
      // LEFT
      y = y0 + ((y1 - y0) * (xMin - x0)) / (x1 - x0);
      x = xMin;
    }

    if (codeOut === code0) {
      x0 = x;
      y0 = y;
      code0 = outcode(x0, y0, rect);
    } else {
      x1 = x;
      y1 = y;
      code1 = outcode(x1, y1, rect);
    }
  }
}

// ── Line segment ↔ segment intersection ────────────────────────────────────

/**
 * Cross product of vectors (o→a) and (o→b).
 */
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Test whether two line segments intersect (excluding collinear overlap).
 * Uses the cross-product orientation test.
 */
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

// ── Waypoint helpers ───────────────────────────────────────────────────────

/**
 * Deep-clone an array of waypoints to plain `{ x, y }` objects.
 *
 * Strips any extra properties (e.g. bpmn-js `original` references)
 * and avoids mutating the source waypoints.
 */
export function cloneWaypoints(wps: ReadonlyArray<{ x: number; y: number }>): Point[] {
  return wps.map((wp) => ({ x: wp.x, y: wp.y }));
}

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
 * This handles the common failure mode where detours or nudges repeatedly
 * visit the same two waypoints before finally continuing toward the target.
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

// ── Connection alignment helpers ───────────────────────────────────────────

/**
 * Connection stub used by `getTakenConnectionAlignments`.
 * Accepts any object with the required shape — no bpmn-js dependency.
 */
export interface ConnectionStub {
  type: string;
  source?: { id: string };
  target?: { id: string };
  waypoints?: ReadonlyArray<{ x: number; y: number }>;
}

/**
 * Compute the approximate orientation of a connection endpoint relative
 * to an element's centre point.
 *
 * Mirrors `getApproximateOrientation()` from bpmn-js
 * `AdaptiveLabelPositioningBehavior`.
 *
 * @param midX  Element centre X.
 * @param midY  Element centre Y.
 * @param wpX   Waypoint X (the connection's docking point near the element).
 * @param wpY   Waypoint Y.
 */
export function getApproximateOrientation(
  midX: number,
  midY: number,
  wpX: number,
  wpY: number
): 'top' | 'bottom' | 'left' | 'right' {
  const dx = wpX - midX;
  const dy = wpY - midY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

/**
 * Compute the set of connection alignments that are "taken" for an element.
 *
 * Iterates all incoming and outgoing connections and computes the approximate
 * orientation of each connection's docking waypoint relative to the element's
 * centre.  The returned set describes which sides of the element already have
 * connections docking onto them.
 *
 * Mirrors `getTakenAlignments()` from bpmn-js
 * `AdaptiveLabelPositioningBehavior`:
 * - For incoming connections: examines the **last** waypoint (target dock).
 * - For outgoing connections: examines the **first** waypoint (source dock).
 *
 * Only `bpmn:SequenceFlow` and `bpmn:MessageFlow` connections are considered;
 * associations and data associations are ignored.
 *
 * @param element     The element whose taken alignments to compute.
 * @param connections All connections (flows) in the diagram.
 * @returns Set of taken alignment sides.
 */
export function getTakenConnectionAlignments(
  element: Rect & { id?: string },
  connections: ReadonlyArray<ConnectionStub>
): Set<'top' | 'bottom' | 'left' | 'right'> {
  const midX = element.x + element.width / 2;
  const midY = element.y + element.height / 2;
  const elementId = (element as { id?: string }).id;

  const taken = new Set<'top' | 'bottom' | 'left' | 'right'>();

  for (const conn of connections) {
    // Only sequence and message flows
    if (conn.type !== 'bpmn:SequenceFlow' && conn.type !== 'bpmn:MessageFlow') continue;

    const wps = conn.waypoints;
    if (!wps || wps.length < 2) continue;

    const sourceId = conn.source?.id;
    const targetId = conn.target?.id;

    // Outgoing: element is the source → examine first waypoint (source dock)
    if (elementId !== undefined && sourceId === elementId) {
      const wp = wps[0];
      taken.add(getApproximateOrientation(midX, midY, wp.x, wp.y));
    }

    // Incoming: element is the target → examine last waypoint (target dock)
    if (elementId !== undefined && targetId === elementId) {
      const wp = wps[wps.length - 1];
      taken.add(getApproximateOrientation(midX, midY, wp.x, wp.y));
    }
  }

  return taken;
}
