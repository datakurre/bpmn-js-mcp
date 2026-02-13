/**
 * Post-processing function that adjusts external labels to avoid overlaps
 * with connections and other labels.
 *
 * Entry points:
 * - `adjustDiagramLabels(diagram)` — adjusts all labels in a diagram
 * - `adjustElementLabel(diagram, elementId)` — adjusts a single element's label
 */

import { type DiagramState } from '../../../types';
import {
  type Point,
  type Rect,
  type LabelOrientation,
  getLabelCandidatePositions,
  scoreLabelPosition,
  getLabelRect,
} from './label-utils';
import { getVisibleElements, syncXml } from '../../helpers';

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

/** Collect all connection segments from all visible connections. */
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

/**
 * Collect segments from flows that are directly attached to a given element
 * (outgoing or incoming).  Used to apply a heavier penalty for boundary
 * event labels overlapping their own outgoing flows.
 */
function collectOwnFlowSegments(elementId: string, elements: any[]): [Point, Point][] {
  const segments: [Point, Point][] = [];
  for (const el of elements) {
    if (
      (el.type === 'bpmn:SequenceFlow' ||
        el.type === 'bpmn:MessageFlow' ||
        el.type === 'bpmn:Association') &&
      el.waypoints?.length >= 2 &&
      (el.source?.id === elementId || el.target?.id === elementId)
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

// ── Core adjustment logic ──────────────────────────────────────────────────

/**
 * Determine the current label orientation relative to its element.
 * Compares the label's centre position to the element's bounding box
 * to classify as 'top', 'bottom', 'left', or 'right'.
 */
function getCurrentLabelOrientation(el: any, label: any): LabelOrientation {
  const labelMidY = label.y + (label.height || 20) / 2;
  const labelMidX = label.x + (label.width || 90) / 2;

  // Check vertical position first (most common for events)
  if (labelMidY < el.y) return 'top';
  if (labelMidY > el.y + el.height) return 'bottom';

  // Horizontal position
  if (labelMidX < el.x) return 'left';
  return 'right';
}

/** Try to reposition a single element label. Returns updated rect if moved. */
function tryRepositionLabel(
  el: any,
  shapeRects: Rect[],
  connectionSegments: [Point, Point][],
  labelRects: Map<string, Rect>,
  modeling: any,
  ownFlowSegments?: [Point, Point][]
): Rect | null {
  const label = el.label;
  if (!label) return null;

  const currentRect = getLabelRect(label);
  const otherLabelRects = Array.from(labelRects.entries())
    .filter(([id]) => id !== el.id)
    .map(([, r]) => r);

  let hostRect: Rect | undefined;
  if (el.type === BOUNDARY_EVENT_TYPE && el.host) {
    hostRect = { x: el.host.x, y: el.host.y, width: el.host.width, height: el.host.height };
  }

  const otherShapeRects = shapeRects.filter(
    (sr) => sr.x !== el.x || sr.y !== el.y || sr.width !== el.width || sr.height !== el.height
  );

  const currentScore = scoreLabelPosition(
    currentRect,
    connectionSegments,
    otherLabelRects,
    hostRect,
    otherShapeRects,
    ownFlowSegments
  );

  const actualLabelSize = { width: label.width || 90, height: label.height || 20 };
  const candidates = getLabelCandidatePositions(el, actualLabelSize);

  // When current position has no overlaps, still check if the label is at
  // the preferred orientation for this element type.  Events prefer bottom
  // labels (matching bpmn-js convention), gateways prefer top.  After ELK
  // layout moves elements, labels may end up at non-preferred orientations
  // that happen to be overlap-free.
  if (currentScore === 0) {
    const currentOrientation = getCurrentLabelOrientation(el, el.label);
    const preferredOrientation = candidates[0]?.orientation;

    if (currentOrientation !== preferredOrientation && preferredOrientation) {
      // Label is at a non-preferred orientation — try the preferred position
      const preferredCandidate = candidates[0];
      const preferredScore = scoreLabelPosition(
        preferredCandidate.rect,
        connectionSegments,
        otherLabelRects,
        hostRect,
        otherShapeRects,
        ownFlowSegments
      );

      if (preferredScore === 0) {
        // Preferred position is also overlap-free — move there
        const dx = preferredCandidate.rect.x - label.x;
        const dy = preferredCandidate.rect.y - label.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          modeling.moveShape(label, { x: dx, y: dy });
          return preferredCandidate.rect;
        }
      }
    }
    return null;
  }
  let bestScore = currentScore;
  let bestCandidate: (typeof candidates)[0] | null = null;

  for (const candidate of candidates) {
    const score = scoreLabelPosition(
      candidate.rect,
      connectionSegments,
      otherLabelRects,
      hostRect,
      otherShapeRects,
      ownFlowSegments
    );
    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) return null;

  const dx = bestCandidate.rect.x - label.x;
  const dy = bestCandidate.rect.y - label.y;
  if (dx === 0 && dy === 0) return null;

  modeling.moveShape(label, { x: dx, y: dy });
  return bestCandidate.rect;
}

/**
 * Adjust all external labels in a diagram to minimise overlap with
 * connections and other labels.
 *
 * Returns the number of labels that were moved.
 */
export async function adjustDiagramLabels(diagram: DiagramState): Promise<number> {
  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  const connectionSegments = collectConnectionSegments(allElements);

  // Collect all shape rects (non-connections, non-labels) for overlap checking
  const shapeRects: Rect[] = allElements
    .filter(
      (el: any) =>
        el.type &&
        !el.type.includes('SequenceFlow') &&
        !el.type.includes('MessageFlow') &&
        !el.type.includes('Association') &&
        el.type !== 'bpmn:Participant' &&
        el.type !== 'bpmn:Lane' &&
        el.width &&
        el.height
    )
    .map((el: any) => ({ x: el.x, y: el.y, width: el.width, height: el.height }));

  // Collect all elements with external labels
  const labelBearers = allElements.filter(
    (el: any) => hasExternalLabel(el.type) && el.label && el.businessObject?.name
  );

  if (labelBearers.length === 0) return 0;

  // Collect current label rects for cross-label overlap checking
  const labelRects = new Map<string, Rect>();
  for (const el of labelBearers) {
    if (el.label) {
      labelRects.set(el.id, getLabelRect(el.label));
    }
  }

  let movedCount = 0;

  for (const el of labelBearers) {
    // For boundary events, collect their own outgoing flow segments
    // to apply a heavier overlap penalty (their outgoing flows exit
    // downward, right where the default 'bottom' label would be).
    const ownFlows =
      el.type === BOUNDARY_EVENT_TYPE ? collectOwnFlowSegments(el.id, allElements) : undefined;
    const newRect = tryRepositionLabel(
      el,
      shapeRects,
      connectionSegments,
      labelRects,
      modeling,
      ownFlows
    );
    if (newRect) {
      labelRects.set(el.id, newRect);
      movedCount++;
    }
  }

  // Centering pass: ensure top/bottom labels have their horizontal centre
  // aligned with the element centre.  This catches labels that were moved
  // by external code (boundary event repositioning, ELK layout) rather
  // than by tryRepositionLabel above.
  // Skip boundary events — their labels are deliberately placed at
  // left/right to avoid overlapping their own outgoing flows.
  for (const el of labelBearers) {
    if (el.type === BOUNDARY_EVENT_TYPE) continue;
    const label = el.label;
    if (!label) continue;
    const orientation = getCurrentLabelOrientation(el, label);
    if (orientation !== 'top' && orientation !== 'bottom') continue;

    const elementCenterX = el.x + el.width / 2;
    const labelCenterX = label.x + (label.width || 90) / 2;
    const dx = Math.round(elementCenterX - labelCenterX);
    if (Math.abs(dx) > 1) {
      modeling.moveShape(label, { x: dx, y: 0 });
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
  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const el = elementRegistry.get(elementId);

  if (!el || !el.label || !hasExternalLabel(el.type) || !el.businessObject?.name) {
    return false;
  }

  const allElements = getVisibleElements(elementRegistry);
  const connectionSegments = collectConnectionSegments(allElements);

  // Collect nearby shape rects for overlap checking
  const shapeRects: Rect[] = allElements
    .filter(
      (other: any) =>
        other.id !== elementId &&
        other.type &&
        !other.type.includes('SequenceFlow') &&
        !other.type.includes('MessageFlow') &&
        !other.type.includes('Association') &&
        other.type !== 'bpmn:Participant' &&
        other.type !== 'bpmn:Lane' &&
        other.width &&
        other.height
    )
    .map((other: any) => ({ x: other.x, y: other.y, width: other.width, height: other.height }));

  // Other labels
  const otherLabelRects: Rect[] = allElements
    .filter((other: any) => other.id !== elementId && other.label && hasExternalLabel(other.type))
    .map((other: any) => getLabelRect(other.label));

  // Host rect for boundary events
  let hostRect: Rect | undefined;
  if (el.type === BOUNDARY_EVENT_TYPE && el.host) {
    hostRect = { x: el.host.x, y: el.host.y, width: el.host.width, height: el.host.height };
  }

  // Own outgoing flow segments for boundary events
  const ownFlowSegments =
    el.type === BOUNDARY_EVENT_TYPE ? collectOwnFlowSegments(el.id, allElements) : undefined;

  const label = el.label;
  const currentRect = getLabelRect(label);
  const currentScore = scoreLabelPosition(
    currentRect,
    connectionSegments,
    otherLabelRects,
    hostRect,
    shapeRects,
    ownFlowSegments
  );

  if (currentScore === 0) return false;

  const labelSz = { width: label.width || 90, height: label.height || 20 };
  const candidates = getLabelCandidatePositions(el, labelSz);
  let bestScore = currentScore;
  let bestCandidate: (typeof candidates)[0] | null = null;

  for (const candidate of candidates) {
    const score = scoreLabelPosition(
      candidate.rect,
      connectionSegments,
      otherLabelRects,
      hostRect,
      shapeRects,
      ownFlowSegments
    );
    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate) {
    const dx = bestCandidate.rect.x - label.x;
    const dy = bestCandidate.rect.y - label.y;
    if (dx !== 0 || dy !== 0) {
      modeling.moveShape(label, { x: dx, y: dy });
      await syncXml(diagram);
      return true;
    }
  }

  return false;
}

// Re-export flow label adjustment from split module
export { adjustFlowLabels, centerFlowLabels } from './adjust-flow-labels';
