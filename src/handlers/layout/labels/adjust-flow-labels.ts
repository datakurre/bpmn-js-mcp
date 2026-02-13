/**
 * Flow label adjustment: nudges connection (sequence flow) labels to avoid
 * overlapping shapes, other labels, and crossing connection segments.
 *
 * Split from adjust-labels.ts for file-size compliance.
 */

import { type DiagramState } from '../../../types';
import { FLOW_LABEL_INDENT, LABEL_SHAPE_PROXIMITY_MARGIN } from '../../../constants';
import {
  type Point,
  type Rect,
  rectsOverlap,
  rectsNearby,
  segmentIntersectsRect,
  getLabelRect,
} from './label-utils';
import { getVisibleElements, syncXml } from '../../helpers';

/** Indexed shape rects: parallel arrays of Rects and their element IDs. */
interface ShapeRectIndex {
  rects: Rect[];
  ids: string[];
}

/** Build shape rects with element IDs for per-flow endpoint exclusion. */
function buildShapeRectIndex(elements: any[]): ShapeRectIndex {
  const shapes = elements.filter(
    (el: any) =>
      el.type &&
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.width &&
      el.height
  );
  return {
    rects: shapes.map((el: any) => ({ x: el.x, y: el.y, width: el.width, height: el.height })),
    ids: shapes.map((el: any) => el.id),
  };
}

/**
 * Return shape rects excluding the flow's own source and target.
 * A flow label is expected to be near its endpoints — nudging it away
 * from them is counterproductive, especially for short connections.
 */
function getNonEndpointShapes(index: ShapeRectIndex, sourceId?: string, targetId?: string): Rect[] {
  const result: Rect[] = [];
  for (let i = 0; i < index.rects.length; i++) {
    if (index.ids[i] !== sourceId && index.ids[i] !== targetId) {
      result.push(index.rects[i]);
    }
  }
  return result;
}

/** Indexed connection segments for per-flow exclusion. */
interface ConnectionSegmentIndex {
  segments: [Point, Point][];
  flowIds: string[];
}

/** Collect all connection segments with their flow IDs. */
function collectConnectionSegmentIndex(elements: any[]): ConnectionSegmentIndex {
  const segments: [Point, Point][] = [];
  const flowIds: string[] = [];
  for (const el of elements) {
    if (
      (el.type === 'bpmn:SequenceFlow' ||
        el.type === 'bpmn:MessageFlow' ||
        el.type === 'bpmn:Association') &&
      el.waypoints?.length >= 2
    ) {
      for (let i = 0; i < el.waypoints.length - 1; i++) {
        segments.push([
          { x: el.waypoints[i].x, y: el.waypoints[i].y },
          { x: el.waypoints[i + 1].x, y: el.waypoints[i + 1].y },
        ]);
        flowIds.push(el.id);
      }
    }
  }
  return { segments, flowIds };
}

/** Get connection segments excluding a specific flow's own segments. */
function getNonOwnSegments(index: ConnectionSegmentIndex, excludeFlowId: string): [Point, Point][] {
  const result: [Point, Point][] = [];
  for (let i = 0; i < index.segments.length; i++) {
    if (index.flowIds[i] !== excludeFlowId) {
      result.push(index.segments[i]);
    }
  }
  return result;
}

/** Get a specific flow's own segments. */
function getOwnSegments(index: ConnectionSegmentIndex, flowId: string): [Point, Point][] {
  const result: [Point, Point][] = [];
  for (let i = 0; i < index.segments.length; i++) {
    if (index.flowIds[i] === flowId) {
      result.push(index.segments[i]);
    }
  }
  return result;
}

/** Score a nudge candidate for a flow label. Lower is better (0 = no overlap). */
function scoreNudgedRect(
  nudgedRect: Rect,
  shapeRects: Rect[],
  otherFlowLabels: Rect[],
  connectionSegments: [Point, Point][]
): number {
  let score = 0;
  if (shapeRects.some((sr) => rectsOverlap(nudgedRect, sr))) {
    score += 5;
  } else if (shapeRects.some((sr) => rectsNearby(nudgedRect, sr, LABEL_SHAPE_PROXIMITY_MARGIN))) {
    score += 1;
  }
  if (otherFlowLabels.some((lr) => rectsOverlap(nudgedRect, lr))) score += 3;
  for (const [s1, s2] of connectionSegments) {
    if (segmentIntersectsRect(s1, s2, nudgedRect)) score += 1;
  }
  return score;
}

/**
 * Find a small nudge to move a flow label off its own flow line.
 * Uses a minimal perpendicular displacement (10–15px) so the label
 * remains adjacent to but no longer overlapping the flow path.
 */
function findSelfFlowNudge(
  labelRect: Rect,
  perpX: number,
  perpY: number,
  ownSegments: [Point, Point][]
): { x: number; y: number } | null {
  // Small distances — just enough to clear the flow line
  const nudgeDistances = [10, 15];
  let bestNudge: { x: number; y: number } | null = null;

  for (const amount of nudgeDistances) {
    for (const sign of [1, -1]) {
      const nudge = { x: perpX * amount * sign, y: perpY * amount * sign };
      const nudgedRect: Rect = {
        x: labelRect.x + nudge.x,
        y: labelRect.y + nudge.y,
        width: labelRect.width,
        height: labelRect.height,
      };
      const cleared = !ownSegments.some(([p1, p2]) => segmentIntersectsRect(p1, p2, nudgedRect));
      if (cleared) {
        bestNudge = nudge;
        break;
      }
    }
    if (bestNudge) break;
  }

  return bestNudge;
}

/** Find the best nudge direction/distance for a flow label. */
function findBestNudge(
  labelRect: Rect,
  perpX: number,
  perpY: number,
  shapeRects: Rect[],
  otherFlowLabels: Rect[],
  connectionSegments: [Point, Point][]
): { x: number; y: number } | null {
  const nudgeDistances = [FLOW_LABEL_INDENT + 10, FLOW_LABEL_INDENT + 25];
  let bestNudge: { x: number; y: number } | null = null;
  let bestScore = Infinity;

  for (const amount of nudgeDistances) {
    for (const sign of [1, -1]) {
      const nudge = { x: perpX * amount * sign, y: perpY * amount * sign };
      const nudgedRect: Rect = {
        x: labelRect.x + nudge.x,
        y: labelRect.y + nudge.y,
        width: labelRect.width,
        height: labelRect.height,
      };
      const score = scoreNudgedRect(nudgedRect, shapeRects, otherFlowLabels, connectionSegments);
      if (score < bestScore) {
        bestScore = score;
        bestNudge = nudge;
        if (score === 0) break;
      }
    }
    if (bestScore === 0) break;
  }

  return bestNudge;
}

/** Overlap flags for a flow label. */
interface FlowLabelOverlaps {
  overlapsShape: boolean;
  tooCloseToShape: boolean;
  overlapsLabel: boolean;
  crossesConnection: boolean;
  crossesOwnFlow: boolean;
}

/** Detect all overlap conditions for a flow label. */
function detectFlowLabelOverlaps(
  labelRect: Rect,
  shapes: Rect[],
  otherFlowLabels: Rect[],
  otherSegments: [Point, Point][],
  ownSegments: [Point, Point][]
): FlowLabelOverlaps {
  return {
    overlapsShape: shapes.some((sr) => rectsOverlap(labelRect, sr)),
    tooCloseToShape: shapes.some((sr) => rectsNearby(labelRect, sr, LABEL_SHAPE_PROXIMITY_MARGIN)),
    overlapsLabel: otherFlowLabels.some((lr) => rectsOverlap(labelRect, lr)),
    crossesConnection: otherSegments.some(([p1, p2]) => segmentIntersectsRect(p1, p2, labelRect)),
    crossesOwnFlow: ownSegments.some(([p1, p2]) => segmentIntersectsRect(p1, p2, labelRect)),
  };
}

/** Check if any overlap condition is true. */
function hasAnyOverlap(o: FlowLabelOverlaps): boolean {
  return (
    o.overlapsShape ||
    o.tooCloseToShape ||
    o.overlapsLabel ||
    o.crossesConnection ||
    o.crossesOwnFlow
  );
}

/**
 * Compute the midpoint of a flow's waypoints along the path.
 *
 * For a 2-waypoint flow, this is the geometric midpoint of the single
 * segment.  For multi-waypoint flows, walks 50% of the total path length
 * to find the exact midpoint, which may fall on any segment.
 */
function computeFlowMidpoint(waypoints: Array<{ x: number; y: number }>): Point {
  if (waypoints.length === 2) {
    return {
      x: (waypoints[0].x + waypoints[1].x) / 2,
      y: (waypoints[0].y + waypoints[1].y) / 2,
    };
  }

  // Compute total path length
  let totalLength = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    totalLength += Math.sqrt(dx * dx + dy * dy);
  }

  // Walk to 50% of path length
  const halfLength = totalLength / 2;
  let walked = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (walked + segLen >= halfLength && segLen > 0) {
      const t = (halfLength - walked) / segLen;
      return {
        x: waypoints[i - 1].x + dx * t,
        y: waypoints[i - 1].y + dy * t,
      };
    }
    walked += segLen;
  }

  // Fallback: geometric midpoint of first and last
  return {
    x: (waypoints[0].x + waypoints[waypoints.length - 1].x) / 2,
    y: (waypoints[0].y + waypoints[waypoints.length - 1].y) / 2,
  };
}

/**
 * Center flow labels on their connection's midpoint.
 *
 * After layout recomputes waypoints, flow labels may be stranded far
 * from their connection's current geometry.  This pass repositions each
 * labeled flow's label so its centre sits at the flow's path midpoint,
 * offset slightly perpendicular to the flow direction (above for
 * horizontal flows, to the left for vertical flows).
 *
 * Should run BEFORE the overlap-nudge pass (adjustFlowLabels) so that
 * nudging starts from a geometrically correct baseline.
 *
 * Returns the number of flow labels moved.
 */
export async function centerFlowLabels(diagram: DiagramState): Promise<number> {
  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  const labeledFlows = allElements.filter(
    (el: any) =>
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.label &&
      el.businessObject?.name &&
      el.waypoints?.length >= 2
  );

  let movedCount = 0;

  for (const flow of labeledFlows) {
    const label = flow.label;
    const waypoints = flow.waypoints;

    const midpoint = computeFlowMidpoint(waypoints);

    // Compute perpendicular offset direction at the midpoint's segment
    const midIdx = Math.min(Math.floor(waypoints.length / 2), waypoints.length - 1);
    const p1 = waypoints[Math.max(0, midIdx - 1)];
    const p2 = waypoints[midIdx];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    // Perpendicular unit vector (rotated 90° counter-clockwise)
    const perpX = -dy / len;
    const perpY = dx / len;

    // Offset the label above (for horizontal flows) or to the left
    // (for vertical flows) by a small amount.  Use negative sign to
    // place above/left rather than below/right.
    const offset = FLOW_LABEL_INDENT;
    const labelW = label.width || 90;
    const labelH = label.height || 20;

    // Position label centred on midpoint, shifted perpendicular
    const targetX = Math.round(midpoint.x + perpX * offset - labelW / 2);
    const targetY = Math.round(midpoint.y + perpY * offset - labelH / 2);

    const moveX = targetX - label.x;
    const moveY = targetY - label.y;

    // Only move if displacement is significant (> 2px)
    if (Math.abs(moveX) > 2 || Math.abs(moveY) > 2) {
      modeling.moveShape(label, { x: moveX, y: moveY });
      movedCount++;
    }
  }

  if (movedCount > 0) await syncXml(diagram);
  return movedCount;
}

/**
 * Adjust labels on connections (sequence flows) to avoid overlapping shapes,
 * other flow labels, and crossing connection segments.
 *
 * Returns the number of flow labels moved.
 */
export async function adjustFlowLabels(diagram: DiagramState): Promise<number> {
  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  const shapeIndex = buildShapeRectIndex(allElements);
  const segmentIndex = collectConnectionSegmentIndex(allElements);

  const labeledFlows = allElements.filter(
    (el: any) =>
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.label &&
      el.businessObject?.name
  );

  const flowLabelRects = new Map<string, Rect>();
  for (const flow of labeledFlows) {
    if (flow.label) flowLabelRects.set(flow.id, getLabelRect(flow.label));
  }

  let movedCount = 0;

  for (const flow of labeledFlows) {
    const label = flow.label;
    const labelRect = getLabelRect(label);

    const shapes = getNonEndpointShapes(shapeIndex, flow.source?.id, flow.target?.id);
    const otherSegments = getNonOwnSegments(segmentIndex, flow.id);
    const ownSegments = getOwnSegments(segmentIndex, flow.id);

    const otherFlowLabels = Array.from(flowLabelRects.entries())
      .filter(([id]) => id !== flow.id)
      .map(([, r]) => r);

    const overlaps = detectFlowLabelOverlaps(
      labelRect,
      shapes,
      otherFlowLabels,
      otherSegments,
      ownSegments
    );

    if (!hasAnyOverlap(overlaps)) continue;

    const waypoints = flow.waypoints;
    if (!waypoints || waypoints.length < 2) continue;

    const midIdx = Math.floor(waypoints.length / 2);
    const p1 = waypoints[midIdx - 1] || waypoints[0];
    const p2 = waypoints[midIdx];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    // When the only issue is crossing the flow's own segments, use a small
    // nudge (just enough to clear the flow line) rather than the larger
    // distances used for cross-flow/shape conflicts.
    const onlySelfCrossing =
      overlaps.crossesOwnFlow &&
      !overlaps.overlapsShape &&
      !overlaps.tooCloseToShape &&
      !overlaps.overlapsLabel &&
      !overlaps.crossesConnection;

    const bestNudge = onlySelfCrossing
      ? findSelfFlowNudge(labelRect, -dy / len, dx / len, ownSegments)
      : findBestNudge(labelRect, -dy / len, dx / len, shapes, otherFlowLabels, otherSegments);

    if (bestNudge) {
      modeling.moveShape(label, bestNudge);
      flowLabelRects.set(flow.id, {
        x: labelRect.x + bestNudge.x,
        y: labelRect.y + bestNudge.y,
        width: labelRect.width,
        height: labelRect.height,
      });
      movedCount++;
    }
  }

  if (movedCount > 0) await syncXml(diagram);
  return movedCount;
}
