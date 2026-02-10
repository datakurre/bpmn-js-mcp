/**
 * Post-processing function that adjusts external labels to avoid overlaps
 * with connections and other labels.
 *
 * Entry points:
 * - `adjustDiagramLabels(diagram)` — adjusts all labels in a diagram
 * - `adjustElementLabel(diagram, elementId)` — adjusts a single element's label
 */

import { type DiagramState } from '../types';
import {
  type Point,
  type Rect,
  getLabelCandidatePositions,
  scoreLabelPosition,
} from './label-utils';
import { getVisibleElements, syncXml } from './helpers';

// ── Helpers ────────────────────────────────────────────────────────────────

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

/** Get the bounding rect of a label shape. */
function getLabelRect(label: any): Rect {
  return {
    x: label.x,
    y: label.y,
    width: label.width || 90,
    height: label.height || 20,
  };
}

// ── Core adjustment logic ──────────────────────────────────────────────────

/** Try to reposition a single element label. Returns updated rect if moved. */
function tryRepositionLabel(
  el: any,
  shapeRects: Rect[],
  connectionSegments: [Point, Point][],
  labelRects: Map<string, Rect>,
  modeling: any
): Rect | null {
  const label = el.label;
  if (!label) return null;

  const currentRect = getLabelRect(label);
  const otherLabelRects = Array.from(labelRects.entries())
    .filter(([id]) => id !== el.id)
    .map(([, r]) => r);

  let hostRect: Rect | undefined;
  if (el.type === 'bpmn:BoundaryEvent' && el.host) {
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
    otherShapeRects
  );
  if (currentScore === 0) return null;

  const candidates = getLabelCandidatePositions(el);
  let bestScore = currentScore;
  let bestCandidate: (typeof candidates)[0] | null = null;

  for (const candidate of candidates) {
    const score = scoreLabelPosition(
      candidate.rect,
      connectionSegments,
      otherLabelRects,
      hostRect,
      otherShapeRects
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
    const newRect = tryRepositionLabel(el, shapeRects, connectionSegments, labelRects, modeling);
    if (newRect) {
      labelRects.set(el.id, newRect);
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
  if (el.type === 'bpmn:BoundaryEvent' && el.host) {
    hostRect = { x: el.host.x, y: el.host.y, width: el.host.width, height: el.host.height };
  }

  const label = el.label;
  const currentRect = getLabelRect(label);
  const currentScore = scoreLabelPosition(
    currentRect,
    connectionSegments,
    otherLabelRects,
    hostRect,
    shapeRects
  );

  if (currentScore === 0) return false;

  const candidates = getLabelCandidatePositions(el);
  let bestScore = currentScore;
  let bestCandidate: (typeof candidates)[0] | null = null;

  for (const candidate of candidates) {
    const score = scoreLabelPosition(
      candidate.rect,
      connectionSegments,
      otherLabelRects,
      hostRect,
      shapeRects
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
export { adjustFlowLabels } from './adjust-flow-labels';
