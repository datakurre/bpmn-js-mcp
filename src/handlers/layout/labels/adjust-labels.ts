/**
 * Post-processing function that adjusts external labels to bpmn-js
 * default positions (matching Camunda Modeler interactive placement).
 *
 * Uses the same formula as bpmn-js `getExternalLabelMid()`:
 * - Events / Gateways / Data objects: label centre below the element
 *   at (element.centerX, element.bottom + DEFAULT_LABEL_SIZE.height / 2)
 * - Flows: label at the midpoint of the first segment, offset perpendicular
 *   to the side (top/bottom/left/right) with fewer shape crossings
 *
 * Boundary events with outgoing flows get their label placed to the left
 * to avoid overlapping the downward-exiting flow.
 *
 * Entry points:
 * - `adjustDiagramLabels(diagram)` — adjusts all element labels in a diagram
 * - `adjustElementLabel(diagram, elementId)` — adjusts a single element's label
 * - `centerFlowLabels(diagram)` — centers flow labels on connection midpoints
 */

import { type DiagramState } from '../../../types';
import type { BpmnElement } from '../../../bpmn-types';
import { DEFAULT_LABEL_SIZE, ELEMENT_LABEL_DISTANCE } from '../../../constants';
import { getVisibleElements, syncXml, getService } from '../../helpers';

// ── Helpers ────────────────────────────────────────────────────────────────

const BOUNDARY_EVENT_TYPE = 'bpmn:BoundaryEvent';

/** Check whether an element type has an external label. */
function hasExternalLabel(type: string): boolean {
  return (
    type.includes('Event') ||
    type.includes('Gateway') ||
    type === 'bpmn:DataStoreReference' ||
    type === 'bpmn:DataObjectReference'
  );
}

/**
 * Compute the bpmn-js default label position for an element.
 *
 * Replicates `getExternalLabelMid()` from bpmn-js/lib/util/LabelUtil:
 *   centre = (element.centerX, element.bottom + DEFAULT_LABEL_SIZE.height / 2)
 *
 * Returns the top-left corner of the label rect.
 */
function getDefaultLabelPosition(
  element: { x: number; y: number; width: number; height: number },
  labelWidth: number,
  labelHeight: number
): { x: number; y: number } {
  const midX = element.x + element.width / 2;
  const midY = element.y + element.height + DEFAULT_LABEL_SIZE.height / 2;
  return {
    x: Math.round(midX - labelWidth / 2),
    y: Math.round(midY - labelHeight / 2),
  };
}

/**
 * Compute the best label position for a boundary event.
 *
 * Boundary events sit on the edge of their host task. Their outgoing flows
 * typically exit downward, so placing the label directly below can overlap
 * the flow line. We score three candidate positions (left, right, below)
 * and pick the one with the fewest shape overlaps.
 *
 * Falls back to "below" when no shapes are provided for scoring.
 */
function getBoundaryEventLabelPosition(
  element: { x: number; y: number; width: number; height: number },
  labelWidth: number,
  labelHeight: number,
  shapes?: Array<{ x: number; y: number; width: number; height: number }>
): { x: number; y: number } {
  const midX = element.x + element.width / 2;
  const midY = element.y + element.height / 2;
  const bottom = element.y + element.height;

  // Three candidate positions: left of event, right of event, below event
  const candidates = [
    {
      x: Math.round(element.x - ELEMENT_LABEL_DISTANCE - labelWidth),
      y: Math.round(midY - labelHeight / 2),
    }, // left
    {
      x: Math.round(element.x + element.width + ELEMENT_LABEL_DISTANCE),
      y: Math.round(midY - labelHeight / 2),
    }, // right
    { x: Math.round(midX - labelWidth / 2), y: Math.round(bottom + ELEMENT_LABEL_DISTANCE) }, // below
  ];

  if (!shapes || shapes.length === 0) {
    // No shape context — prefer below (bpmn-js default for events)
    return candidates[2];
  }

  // Pick candidate with fewest overlapping shapes
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

/**
 * Check whether a boundary event has outgoing flows.
 */
function hasBoundaryOutgoingFlows(elementId: string, elements: any[]): boolean {
  return elements.some(
    (el) =>
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.source?.id === elementId
  );
}

// ── Core adjustment logic ──────────────────────────────────────────────────

/**
 * Adjust all external labels in a diagram to bpmn-js default positions.
 *
 * Returns the number of labels that were moved.
 */
export async function adjustDiagramLabels(diagram: DiagramState): Promise<number> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  // Collect all elements with external labels
  const labelBearers = allElements.filter(
    (el: any) => hasExternalLabel(el.type) && el.label && el.businessObject?.name
  );

  if (labelBearers.length === 0) return 0;

  // Shapes used for overlap scoring (non-container, non-flow)
  const shapes = allElements.filter(
    (el: any) =>
      el.type !== 'label' &&
      !String(el.type).includes('Flow') &&
      !String(el.type).includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.x !== undefined &&
      el.width !== undefined
  );

  let movedCount = 0;

  for (const el of labelBearers) {
    const label = el.label;
    if (!label) continue;

    const labelWidth = label.width || DEFAULT_LABEL_SIZE.width;
    const labelHeight = label.height || DEFAULT_LABEL_SIZE.height;

    let target: { x: number; y: number };

    // Boundary events: use overlap-scored placement (left / right / below)
    if (el.type === BOUNDARY_EVENT_TYPE && hasBoundaryOutgoingFlows(el.id, allElements)) {
      target = getBoundaryEventLabelPosition(el, labelWidth, labelHeight, shapes);
    } else {
      target = getDefaultLabelPosition(el, labelWidth, labelHeight);
    }

    const dx = target.x - label.x;
    const dy = target.y - label.y;

    // Only move if displacement is significant (> 1px)
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      modeling.moveShape(label as unknown as BpmnElement, { x: dx, y: dy });
      movedCount++;
    }
  }

  if (movedCount > 0) {
    await syncXml(diagram);
  }

  return movedCount;
}

/**
 * Adjust the label for a single element (used after adding/connecting).
 *
 * Returns true if the label was moved.
 */
export async function adjustElementLabel(
  diagram: DiagramState,
  elementId: string
): Promise<boolean> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const el = elementRegistry.get(elementId);

  if (!el || !el.label || !hasExternalLabel(el.type) || !el.businessObject?.name) {
    return false;
  }

  const label = el.label;
  const labelWidth = label.width || DEFAULT_LABEL_SIZE.width;
  const labelHeight = label.height || DEFAULT_LABEL_SIZE.height;

  let target: { x: number; y: number };

  if (
    el.type === BOUNDARY_EVENT_TYPE &&
    hasBoundaryOutgoingFlows(el.id, getVisibleElements(elementRegistry))
  ) {
    const shapes = getVisibleElements(elementRegistry).filter(
      (s: any) =>
        s.type !== 'label' &&
        !String(s.type).includes('Flow') &&
        !String(s.type).includes('Association') &&
        s.type !== 'bpmn:Participant' &&
        s.type !== 'bpmn:Lane' &&
        s.x !== undefined &&
        s.width !== undefined
    );
    target = getBoundaryEventLabelPosition(el, labelWidth, labelHeight, shapes);
  } else {
    target = getDefaultLabelPosition(el, labelWidth, labelHeight);
  }

  const dx = target.x - label.x;
  const dy = target.y - label.y;

  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    modeling.moveShape(label as BpmnElement, { x: dx, y: dy });
    await syncXml(diagram);
    return true;
  }

  return false;
}

/** Gap (px) between connection segment and the nearest edge of the label box. */
const FLOW_LABEL_SIDE_OFFSET = 5;

/**
 * Position labeled flow labels at the midpoint of their first segment,
 * offset perpendicular to the side with fewer shape overlaps.
 *
 * - Horizontal first segment → above (preferred) or below.
 * - Vertical first segment   → right (preferred) or left.
 *
 * This matches bpmn-js interactive placement: the label hugs the first
 * bend of the connection rather than floating at the path midpoint.
 *
 * Returns the number of flow labels moved.
 */
export async function centerFlowLabels(diagram: DiagramState): Promise<number> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  // Non-container, non-flow shapes used when scoring candidate sides.
  const shapes = allElements.filter(
    (el: any) =>
      el.type !== 'label' &&
      !String(el.type).includes('Flow') &&
      !String(el.type).includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.x !== undefined &&
      el.width !== undefined
  );

  const labeledFlows = allElements.filter(
    (el: any) =>
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

    const labelW = label.width || DEFAULT_LABEL_SIZE.width;
    const labelH = label.height || DEFAULT_LABEL_SIZE.height;

    const target = computeFirstSegmentLabelPos(waypoints, labelW, labelH, shapes);

    const moveX = target.x - label.x;
    const moveY = target.y - label.y;

    // Only move if displacement is significant (> 2px)
    if (Math.abs(moveX) > 2 || Math.abs(moveY) > 2) {
      modeling.moveShape(label as unknown as BpmnElement, { x: moveX, y: moveY });
      movedCount++;
    }
  }

  if (movedCount > 0) await syncXml(diagram);
  return movedCount;
}

// ── Flow label positioning ─────────────────────────────────────────────────

/**
 * Compute the bpmn-js-style label position for a flow connection.
 *
 * Takes the midpoint of the first segment (waypoints[0] → waypoints[1]),
 * then places the label on the perpendicular side with fewer shape overlaps.
 */
function computeFirstSegmentLabelPos(
  waypoints: Array<{ x: number; y: number }>,
  labelW: number,
  labelH: number,
  shapes: any[]
): { x: number; y: number } {
  const p0 = waypoints[0];
  const p1 = waypoints[1];

  const midX = (p0.x + p1.x) / 2;
  const midY = (p0.y + p1.y) / 2;
  const isHoriz = Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y);

  // Two perpendicular candidates — candidateA is the preferred default side.
  const candidateA = isHoriz
    ? { x: Math.round(midX - labelW / 2), y: Math.round(midY - FLOW_LABEL_SIDE_OFFSET - labelH) } // above
    : { x: Math.round(midX + FLOW_LABEL_SIDE_OFFSET), y: Math.round(midY - labelH / 2) }; // right
  const candidateB = isHoriz
    ? { x: Math.round(midX - labelW / 2), y: Math.round(midY + FLOW_LABEL_SIDE_OFFSET) } // below
    : { x: Math.round(midX - FLOW_LABEL_SIDE_OFFSET - labelW), y: Math.round(midY - labelH / 2) }; // left

  return labelSideScore(candidateA, labelW, labelH, shapes) <=
    labelSideScore(candidateB, labelW, labelH, shapes)
    ? candidateA
    : candidateB;
}

/** Count shape overlaps for a label candidate rect (lower score = better). */
function labelSideScore(
  pos: { x: number; y: number },
  w: number,
  h: number,
  shapes: any[]
): number {
  const x2 = pos.x + w;
  const y2 = pos.y + h;
  let score = 0;
  for (const s of shapes) {
    if (s.x === undefined || s.y === undefined || s.width === undefined || s.height === undefined) {
      continue;
    }
    if (pos.x < s.x + s.width && x2 > s.x && pos.y < s.y + s.height && y2 > s.y) score++;
  }
  return score;
}
