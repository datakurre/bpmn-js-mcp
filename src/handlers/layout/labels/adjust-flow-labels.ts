/**
 * Flow label adjustment: nudges connection (sequence flow) labels to avoid
 * overlapping shapes, other labels, and crossing connection segments.
 *
 * Split from adjust-labels.ts for file-size compliance.
 */

import { type DiagramState } from '../../../types';
import { FLOW_LABEL_INDENT } from '../../../constants';
import { type Rect, getLabelRect } from './label-utils';
import { computeFlowMidpoint, findPreferredLabelSegmentIndex } from './flow-label-geometry';
import {
  buildShapeRectIndex,
  getNonEndpointShapes,
  collectConnectionSegmentIndex,
  getNonOwnSegments,
  getOwnSegments,
  findSelfFlowNudge,
  findBestNudge,
  detectFlowLabelOverlaps,
  hasAnyOverlap,
} from './flow-label-nudge';
import type { BpmnElement } from '../../../bpmn-types';
import { getVisibleElements, syncXml, getService } from '../../helpers';

/** Indexed shape rects: parallel arrays of Rects and their element IDs. */
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
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  const labeledFlows = allElements.filter(
    (el) =>
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.label &&
      el.businessObject?.name &&
      el.waypoints &&
      el.waypoints.length >= 2
  );

  let movedCount = 0;

  for (const flow of labeledFlows) {
    const label = flow.label!;
    const waypoints = flow.waypoints!;

    const midpoint = computeFlowMidpoint(waypoints);

    // Compute perpendicular offset direction at the midpoint's segment.
    // For L/Z-shaped flows, use the preferred label segment so the
    // perpendicular direction matches the segment the label sits on.
    const preferredIdx = findPreferredLabelSegmentIndex(waypoints);
    const segIdx =
      preferredIdx >= 0
        ? preferredIdx
        : Math.min(Math.floor(waypoints.length / 2), waypoints.length - 1);
    const p1 = waypoints[preferredIdx >= 0 ? segIdx : Math.max(0, segIdx - 1)];
    const p2 = waypoints[preferredIdx >= 0 ? segIdx + 1 : segIdx];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    // Perpendicular unit vector (rotated 90° clockwise so that the label
    // lands above a rightward horizontal flow and to the right of a
    // downward vertical flow — matching Camunda Modeler defaults).
    const perpX = dy / len;
    const perpY = -dx / len;

    // Offset the label above (for horizontal flows) or to the right
    // (for vertical flows) by a small amount.
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
      modeling.moveShape(label as unknown as BpmnElement, { x: moveX, y: moveY });
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
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
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
    const label = flow.label!;
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

    // Use the preferred label segment for perpendicular direction
    const prefIdx = findPreferredLabelSegmentIndex(waypoints);
    const midIdx2 = Math.floor(waypoints.length / 2);
    const segStart = prefIdx >= 0 ? waypoints[prefIdx] : waypoints[midIdx2 - 1] || waypoints[0];
    const segEnd = prefIdx >= 0 ? waypoints[prefIdx + 1] : waypoints[midIdx2];
    const dx = segEnd.x - segStart.x;
    const dy = segEnd.y - segStart.y;
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
      modeling.moveShape(label as unknown as BpmnElement, bestNudge);
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
