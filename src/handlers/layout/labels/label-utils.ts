/**
 * Geometry helpers for label-overlap detection and resolution.
 *
 * Pure functions — no bpmn-js dependency, just math.
 */

import {
  ELEMENT_LABEL_DISTANCE,
  ELEMENT_LABEL_BOTTOM_EXTRA,
  DEFAULT_LABEL_SIZE,
  LABEL_POSITION_PRIORITY,
  EVENT_LABEL_POSITION_PRIORITY,
  BOUNDARY_EVENT_LABEL_POSITION_PRIORITY,
  LABEL_SHAPE_PROXIMITY_MARGIN,
  OWN_FLOW_CROSSING_PENALTY,
} from '../../../constants';

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

export type LabelOrientation = 'top' | 'bottom' | 'left' | 'right';

export interface LabelCandidate {
  orientation: LabelOrientation;
  rect: Rect;
}

// ── Label rect helpers ─────────────────────────────────────────────────────

/** Get the bounding rect of a label shape (with default size fallbacks). */
export function getLabelRect(label: any): Rect {
  return {
    x: label.x,
    y: label.y,
    width: label.width || 90,
    height: label.height || 20,
  };
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

// ── Label candidate positions ──────────────────────────────────────────────

/**
 * Generate candidate label positions around an element.
 *
 * Includes 4 cardinal positions (top, bottom, left, right) plus
 * 4 diagonal positions for elements with many connections.
 * Each candidate is centred on the relevant edge, offset by
 * `ELEMENT_LABEL_DISTANCE`.
 *
 * The cardinal order depends on the element type:
 * - Events prefer bottom first (matching bpmn-js default placement).
 * - Gateways and others prefer top first.
 */
// eslint-disable-next-line max-lines-per-function
export function getLabelCandidatePositions(
  element: {
    x: number;
    y: number;
    width: number;
    height: number;
    type?: string;
  },
  labelSize?: { width: number; height: number }
): LabelCandidate[] {
  const midX = element.x + element.width / 2;
  const midY = element.y + element.height / 2;
  // Use actual label dimensions when available so that top/bottom
  // candidates are centred on the element, not on a 90px default.
  const lw = labelSize?.width || DEFAULT_LABEL_SIZE.width;
  const lh = labelSize?.height || DEFAULT_LABEL_SIZE.height;
  const gap = ELEMENT_LABEL_DISTANCE;

  // Choose priority order based on element type
  const isBoundaryEvent = element.type === 'bpmn:BoundaryEvent';
  const isEvent = element.type ? element.type.includes('Event') : false;
  const priority = isBoundaryEvent
    ? BOUNDARY_EVENT_LABEL_POSITION_PRIORITY
    : isEvent
      ? EVENT_LABEL_POSITION_PRIORITY
      : LABEL_POSITION_PRIORITY;

  // Cardinal positions (priority order)
  const cardinals: LabelCandidate[] = priority.map((orientation) => {
    let rect: Rect;
    switch (orientation) {
      case 'top':
        rect = { x: midX - lw / 2, y: element.y - gap - lh, width: lw, height: lh };
        break;
      case 'bottom':
        rect = {
          x: midX - lw / 2,
          y: element.y + element.height + gap + ELEMENT_LABEL_BOTTOM_EXTRA,
          width: lw,
          height: lh,
        };
        break;
      case 'left':
        rect = { x: element.x - gap - lw, y: midY - lh / 2, width: lw, height: lh };
        break;
      case 'right':
        rect = { x: element.x + element.width + gap, y: midY - lh / 2, width: lw, height: lh };
        break;
    }
    return { orientation, rect };
  });

  // Diagonal positions (top-left, top-right, bottom-left, bottom-right)
  const diagonalGap = gap + 5;
  // For diagonals, use default width for scoring envelope but keep actual
  // width for rect sizing so the label centre is computed correctly.
  const dlw = DEFAULT_LABEL_SIZE.width;
  const dlh = DEFAULT_LABEL_SIZE.height;
  const diagonals: LabelCandidate[] = [
    {
      orientation: 'top' as LabelOrientation,
      rect: {
        x: element.x - dlw - diagonalGap + element.width / 2,
        y: element.y - diagonalGap - dlh,
        width: dlw,
        height: dlh,
      },
    },
    {
      orientation: 'top' as LabelOrientation,
      rect: {
        x: element.x + element.width / 2 + diagonalGap,
        y: element.y - diagonalGap - dlh,
        width: dlw,
        height: dlh,
      },
    },
    {
      orientation: 'bottom' as LabelOrientation,
      rect: {
        x: element.x - dlw - diagonalGap + element.width / 2,
        y: element.y + element.height + diagonalGap + ELEMENT_LABEL_BOTTOM_EXTRA,
        width: dlw,
        height: dlh,
      },
    },
    {
      orientation: 'bottom' as LabelOrientation,
      rect: {
        x: element.x + element.width / 2 + diagonalGap,
        y: element.y + element.height + diagonalGap + ELEMENT_LABEL_BOTTOM_EXTRA,
        width: dlw,
        height: dlh,
      },
    },
  ];

  return [...cardinals, ...diagonals];
}

// ── Scoring helpers ────────────────────────────────────────────────────────

/** Compute penalty for a label candidate overlapping connection segments. */
function scoreConnectionCrossings(
  candidateRect: Rect,
  connectionSegments: [Point, Point][]
): number {
  let score = 0;
  for (const [p1, p2] of connectionSegments) {
    if (segmentIntersectsRect(p1, p2, candidateRect)) {
      score += 1;
    }
  }
  return score;
}

/** Compute penalty for a label candidate overlapping nearby shapes. */
function scoreShapeOverlaps(candidateRect: Rect, shapeRects: Rect[]): number {
  let score = 0;
  for (const sr of shapeRects) {
    if (rectsOverlap(candidateRect, sr)) {
      score += 5; // label hidden behind a shape is very bad
    } else if (rectsNearby(candidateRect, sr, LABEL_SHAPE_PROXIMITY_MARGIN)) {
      score += 1; // label too close to a shape — hard to read
    }
  }
  return score;
}

/** Compute penalty for overlapping the element's own outgoing/incoming flows. */
function scoreOwnFlowCrossings(candidateRect: Rect, ownFlowSegments: [Point, Point][]): number {
  let score = 0;
  for (const [p1, p2] of ownFlowSegments) {
    if (segmentIntersectsRect(p1, p2, candidateRect)) {
      score += OWN_FLOW_CROSSING_PENALTY;
    }
  }
  return score;
}

// ── Scoring ────────────────────────────────────────────────────────────────

/**
 * Score a candidate label position.
 *
 * Returns 0 for no collisions.  Higher = worse.
 *
 * @param candidateRect  The label's bounding box at the candidate position.
 * @param connectionSegments  All connection segments in the diagram as pairs of points.
 * @param otherLabelRects  Bounding boxes of other external labels.
 * @param hostRect  Optional host-element rect (for boundary events) to exclude.
 * @param shapeRects  Optional bounding boxes of nearby shapes (tasks, gateways, etc.).
 * @param ownFlowSegments  Optional segments of the element's own outgoing/incoming flows.
 *                         Penalised more heavily than generic crossing segments.
 */
export function scoreLabelPosition(
  candidateRect: Rect,
  connectionSegments: [Point, Point][],
  otherLabelRects: Rect[],
  hostRect?: Rect,
  shapeRects?: Rect[],
  ownFlowSegments?: [Point, Point][]
): number {
  let score = 0;

  // Heavy penalty for negative coordinates — labels outside the visible
  // canvas area are never useful and indicate a positioning bug.
  if (candidateRect.x < 0 || candidateRect.y < 0) {
    score += 100;
  }

  // Penalty for intersecting connection segments
  score += scoreConnectionCrossings(candidateRect, connectionSegments);

  // Penalty for overlapping other labels
  for (const lr of otherLabelRects) {
    if (rectsOverlap(candidateRect, lr)) {
      score += 2; // labels overlapping is worse than crossing a connection
    }
  }

  // Penalty for overlapping host element (boundary events)
  if (hostRect && rectsOverlap(candidateRect, hostRect)) {
    score += 10; // very bad — label hidden behind host
  }

  // Penalty for overlapping nearby shapes (tasks, gateways, etc.)
  if (shapeRects) {
    score += scoreShapeOverlaps(candidateRect, shapeRects);
  }

  // Extra penalty for overlapping the element's own outgoing/incoming flows.
  // These segments always exit near the element, so overlap is systematic
  // rather than coincidental — penalise more heavily to push the label away.
  if (ownFlowSegments) {
    score += scoreOwnFlowCrossings(candidateRect, ownFlowSegments);
  }

  return score;
}
