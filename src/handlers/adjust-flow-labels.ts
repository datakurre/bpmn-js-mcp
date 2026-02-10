/**
 * Flow label adjustment: nudges connection (sequence flow) labels to avoid
 * overlapping shapes, other labels, and crossing connection segments.
 *
 * Split from adjust-labels.ts for file-size compliance.
 */

import { type DiagramState } from '../types';
import { FLOW_LABEL_INDENT, LABEL_SHAPE_PROXIMITY_MARGIN } from '../constants';
import {
  type Point,
  type Rect,
  rectsOverlap,
  rectsNearby,
  segmentIntersectsRect,
} from './label-utils';
import { getVisibleElements, syncXml } from './helpers';

/** Get the bounding rect of a label shape. */
function getLabelRect(label: any): Rect {
  return {
    x: label.x,
    y: label.y,
    width: label.width || 90,
    height: label.height || 20,
  };
}

/** Collect all connection segments from visible connections. */
function collectConnectionSegments(elements: any[]): [Point, Point][] {
  const segments: [Point, Point][] = [];
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
      }
    }
  }
  return segments;
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

  const shapeRects: Rect[] = allElements
    .filter(
      (el: any) =>
        el.type &&
        !el.type.includes('SequenceFlow') &&
        !el.type.includes('MessageFlow') &&
        !el.type.includes('Association') &&
        el.width &&
        el.height
    )
    .map((el: any) => ({ x: el.x, y: el.y, width: el.width, height: el.height }));

  const connectionSegments = collectConnectionSegments(allElements);

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

    const overlapsShape = shapeRects.some((sr) => rectsOverlap(labelRect, sr));
    const tooCloseToShape = shapeRects.some((sr) =>
      rectsNearby(labelRect, sr, LABEL_SHAPE_PROXIMITY_MARGIN)
    );
    const otherFlowLabels = Array.from(flowLabelRects.entries())
      .filter(([id]) => id !== flow.id)
      .map(([, r]) => r);
    const overlapsLabel = otherFlowLabels.some((lr) => rectsOverlap(labelRect, lr));
    const crossesConnection = connectionSegments.some(([p1, p2]) =>
      segmentIntersectsRect(p1, p2, labelRect)
    );

    if (!overlapsShape && !tooCloseToShape && !overlapsLabel && !crossesConnection) continue;

    const waypoints = flow.waypoints;
    if (!waypoints || waypoints.length < 2) continue;

    const midIdx = Math.floor(waypoints.length / 2);
    const p1 = waypoints[midIdx - 1] || waypoints[0];
    const p2 = waypoints[midIdx];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    const bestNudge = findBestNudge(
      labelRect,
      -dy / len,
      dx / len,
      shapeRects,
      otherFlowLabels,
      connectionSegments
    );

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
