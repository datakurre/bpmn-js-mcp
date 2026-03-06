/**
 * Pure helper functions for computing external label positions.
 *
 * Extracted from adjust-labels.ts to keep that file under the max-lines limit.
 * Covers: gateway scoring, lane-boundary awareness, boundary event placement,
 * and flow label positioning.
 */

import {
  DEFAULT_LABEL_SIZE,
  ELEMENT_LABEL_DISTANCE,
  FLOW_LABEL_SIDE_OFFSET,
} from '../../../constants';

// ── Gateway helpers ────────────────────────────────────────────────────────

/** Classify a waypoint into 'top' | 'bottom' | 'left' | 'right' relative to a gateway centre. */
function classifyWaypointSide(
  wp: { x: number; y: number },
  cx: number,
  cy: number,
  dockTol: number
): string {
  if (wp.y < cy - dockTol) return 'top';
  if (wp.y > cy + dockTol) return 'bottom';
  return wp.x <= cx ? 'left' : 'right';
}

/**
 * Determine which sides of a gateway diamond have sequence flow endpoints
 * docked to them.
 */
export function getGatewaySidesWithFlows(
  element: { id?: string; x: number; y: number; width: number; height: number },
  allElements: any[]
): Set<string> {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const DOCK_TOLERANCE = (element.height / 2) * 0.4;
  const elementId = (element as any).id;
  const sides = new Set<string>();
  for (const conn of allElements) {
    if (conn.type !== 'bpmn:SequenceFlow') continue;
    const wps: Array<{ x: number; y: number }> = conn.waypoints;
    if (!wps || wps.length < 2) continue;
    if (conn.source?.id === elementId) {
      sides.add(classifyWaypointSide(wps[0], cx, cy, DOCK_TOLERANCE));
    }
    if (conn.target?.id === elementId) {
      sides.add(classifyWaypointSide(wps[wps.length - 1], cx, cy, DOCK_TOLERANCE));
    }
  }
  return sides;
}

/** Count shapes whose bounds overlap the given label candidate box. */
export function countShapeOverlaps(
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  shapes: any[]
): number {
  let count = 0;
  for (const s of shapes) {
    if (s.x === undefined || s.y === undefined || !s.width || !s.height) {
      continue;
    }
    if (cx1 < s.x + s.width && cx2 > s.x && cy1 < s.y + s.height && cy2 > s.y) {
      count++;
    }
  }
  return count;
}

// ── Lane-boundary helpers ──────────────────────────────────────────────────

/**
 * Find which lane (if any) contains the centre of the given element.
 */
export function findContainingLane(
  element: { x: number; y: number; width: number; height: number },
  allElements: any[]
): { id: string; x: number; y: number; width: number; height: number } | undefined {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  for (const el of allElements) {
    if (el.type !== 'bpmn:Lane') continue;
    if (cx >= el.x && cx <= el.x + el.width && cy >= el.y && cy <= el.y + el.height) {
      return el;
    }
  }
  return undefined;
}

/**
 * Check whether a label candidate rect falls inside a lane that is different
 * from the gateway's own lane.
 */
export function candidateFallsInSiblingLane(
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  gatewayLaneId: string | undefined,
  allElements: any[]
): boolean {
  if (!gatewayLaneId) return false;
  const labelMidX = cx + cw / 2;
  const labelMidY = cy + ch / 2;
  for (const el of allElements) {
    if (el.type !== 'bpmn:Lane' || el.id === gatewayLaneId) continue;
    if (
      labelMidX >= el.x &&
      labelMidX <= el.x + el.width &&
      labelMidY >= el.y &&
      labelMidY <= el.y + el.height
    ) {
      return true;
    }
  }
  return false;
}

// ── Gateway label position ─────────────────────────────────────────────────

/**
 * Compute the best label position for a gateway using four-sided candidate scoring.
 *
 * Penalises: flow-docked sides (+100), shape overlaps (+1 each), sibling-lane
 * placement (+80). Falls back to "below" (bpmn-js default) when all sides score equally.
 */
export function getGatewayLabelPosition(
  element: { id?: string; x: number; y: number; width: number; height: number },
  labelWidth: number,
  labelHeight: number,
  shapes: any[],
  allElements: any[]
): { x: number; y: number } {
  const midX = element.x + element.width / 2;
  const midY = element.y + element.height / 2;
  const bottom = element.y + element.height;
  const top = element.y;
  const vertGap = DEFAULT_LABEL_SIZE.height / 2 - labelHeight / 2;

  const candidates: Array<{ side: string; x: number; y: number }> = [
    { side: 'bottom', x: Math.round(midX - labelWidth / 2), y: Math.round(bottom + vertGap) },
    {
      side: 'top',
      x: Math.round(midX - labelWidth / 2),
      y: Math.round(top - vertGap - labelHeight),
    },
    {
      side: 'right',
      x: Math.round(element.x + element.width + ELEMENT_LABEL_DISTANCE),
      y: Math.round(midY - labelHeight / 2),
    },
    {
      side: 'left',
      x: Math.round(element.x - ELEMENT_LABEL_DISTANCE - labelWidth),
      y: Math.round(midY - labelHeight / 2),
    },
  ];

  const sidesUsed = getGatewaySidesWithFlows(element, allElements);
  const gatewayLaneId = findContainingLane(element, allElements)?.id;

  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    let score = sidesUsed.has(c.side) ? 100 : 0;
    score += countShapeOverlaps(c.x, c.y, c.x + labelWidth, c.y + labelHeight, shapes);
    if (
      candidateFallsInSiblingLane(c.x, c.y, labelWidth, labelHeight, gatewayLaneId, allElements)
    ) {
      score += 80;
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return { x: best.x, y: best.y };
}

// ── Boundary event label position ──────────────────────────────────────────

/**
 * Compute the best label position for a boundary event.
 * Prefers lower-left or lower-right to avoid the downward-exiting flow path.
 */
export function getBoundaryEventLabelPosition(
  element: { x: number; y: number; width: number; height: number },
  labelWidth: number,
  labelHeight: number,
  shapes?: Array<{ x: number; y: number; width: number; height: number }>
): { x: number; y: number } {
  const midX = element.x + element.width / 2;
  const labelY = Math.round(element.y + element.height + ELEMENT_LABEL_DISTANCE);
  const candidates = [
    { x: Math.round(element.x - ELEMENT_LABEL_DISTANCE - labelWidth), y: labelY },
    { x: Math.round(element.x + element.width + ELEMENT_LABEL_DISTANCE), y: labelY },
    { x: Math.round(midX - labelWidth / 2), y: labelY },
  ];
  if (!shapes || shapes.length === 0) return candidates[0];
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    let score = 0;
    const cx2 = c.x + labelWidth;
    const cy2 = c.y + labelHeight;
    for (const s of shapes) {
      if (c.x < s.x + s.width && cx2 > s.x && c.y < s.y + s.height && cy2 > s.y) score++;
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ── Flow label position ────────────────────────────────────────────────────

/** Check if a label rect overlaps a single bound rect. */
function rectOverlaps(
  lx: number,
  ly: number,
  lx2: number,
  ly2: number,
  bx: number,
  by: number,
  bx2: number,
  by2: number
): boolean {
  return lx < bx2 && lx2 > bx && ly < by2 && ly2 > by;
}

/** Count shape overlaps for a label candidate rect (lower score = better). */
export function labelSideScore(
  pos: { x: number; y: number },
  w: number,
  h: number,
  shapes: any[],
  extraObstacles?: Array<{ x: number; y: number; width: number; height: number }>,
  connectedBounds?: Array<{ x: number; y: number; width: number; height: number }>
): number {
  const x2 = pos.x + w;
  const y2 = pos.y + h;
  let score = 0;
  for (const s of shapes) {
    if (s.x === undefined || s.y === undefined || s.width === undefined || s.height === undefined) {
      continue;
    }
    if (rectOverlaps(pos.x, pos.y, x2, y2, s.x, s.y, s.x + s.width, s.y + s.height)) {
      score++;
    }
  }
  if (extraObstacles) {
    for (const obs of extraObstacles) {
      if (rectOverlaps(pos.x, pos.y, x2, y2, obs.x, obs.y, obs.x + obs.width, obs.y + obs.height)) {
        score++;
      }
    }
  }
  // Proximity penalty for connected elements: expand each connected element bound
  // by ELEMENT_LABEL_DISTANCE and treat the expanded zone as an obstacle.  A
  // candidate inside the expanded zone (but possibly NOT overlapping the element
  // itself) is penalised — keeping labels away from their source/target elements.
  if (connectedBounds) {
    for (const cb of connectedBounds) {
      if (
        rectOverlaps(
          pos.x,
          pos.y,
          x2,
          y2,
          cb.x - ELEMENT_LABEL_DISTANCE,
          cb.y - ELEMENT_LABEL_DISTANCE,
          cb.x + cb.width + ELEMENT_LABEL_DISTANCE,
          cb.y + cb.height + ELEMENT_LABEL_DISTANCE
        )
      ) {
        score++;
      }
    }
  }
  return score;
}

/**
 * Compute the bpmn-js-style label position for a flow connection.
 *
 * Picks the middle pair of waypoints. The label is placed on the perpendicular
 * side with fewer shape overlaps.
 *
 * @param extraObstacles - additional bounding boxes (e.g. gateway labels) to avoid
 * @param connectedBounds - bounding boxes of directly-connected elements (source/target);
 *   candidates within ELEMENT_LABEL_DISTANCE of these receive an additional penalty
 */
export function computePathMidpointLabelPos(
  waypoints: Array<{ x: number; y: number }>,
  labelW: number,
  labelH: number,
  shapes: any[],
  extraObstacles?: Array<{ x: number; y: number; width: number; height: number }>,
  connectedBounds?: Array<{ x: number; y: number; width: number; height: number }>
): { x: number; y: number } {
  const mid = waypoints.length / 2 - 1;
  const p0 = waypoints[Math.floor(mid)];
  const p1 = waypoints[Math.ceil(mid + 0.01)];
  const midX = (p0.x + p1.x) / 2;
  const midY = (p0.y + p1.y) / 2;
  const isHoriz = Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y);
  const cA = isHoriz
    ? { x: Math.round(midX - labelW / 2), y: Math.round(midY - FLOW_LABEL_SIDE_OFFSET - labelH) }
    : { x: Math.round(midX + FLOW_LABEL_SIDE_OFFSET), y: Math.round(midY - labelH / 2) };
  const cB = isHoriz
    ? { x: Math.round(midX - labelW / 2), y: Math.round(midY + FLOW_LABEL_SIDE_OFFSET) }
    : { x: Math.round(midX - FLOW_LABEL_SIDE_OFFSET - labelW), y: Math.round(midY - labelH / 2) };
  return labelSideScore(cA, labelW, labelH, shapes, extraObstacles, connectedBounds) <=
    labelSideScore(cB, labelW, labelH, shapes, extraObstacles, connectedBounds)
    ? cA
    : cB;
}
