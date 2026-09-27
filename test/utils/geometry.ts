/**
 * Geometry helpers used only by tests (bounding-box overlap and
 * segment/rectangle intersection checks).
 *
 * Formerly lived in src/geometry.ts, but nothing in production code used
 * them once the layout eval harness (src/eval/) was removed — see #5.
 */
import type { Point, Rect } from '../../src/geometry';

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
