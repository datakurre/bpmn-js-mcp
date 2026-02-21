/**
 * Post-layout artifact repositioning.
 *
 * Artifacts (DataObjectReference, DataStoreReference, TextAnnotation) are
 * excluded from the ELK graph.  This module repositions them relative to
 * their associated flow elements after layout.
 */

import {
  ARTIFACT_BELOW_OFFSET,
  ARTIFACT_ABOVE_OFFSET,
  ARTIFACT_BELOW_MIN,
  ARTIFACT_ABOVE_MIN,
  ARTIFACT_PADDING,
  ARTIFACT_NEGATIVE_PADDING,
  ARTIFACT_SEARCH_HEIGHT,
  BPMN_TASK_WIDTH,
  BPMN_DUMMY_HEIGHT,
  CENTER_FACTOR,
  MOVEMENT_THRESHOLD,
} from './constants';
import {
  isConnection as _isConnection,
  isInfrastructure as _isInfrastructure,
  isArtifact,
  isLayoutableShape,
} from './helpers';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';

/**
 * Find the flow element linked to an artifact via an association.
 */
function findLinkedFlowElement(
  artifact: BpmnElement,
  associations: BpmnElement[]
): BpmnElement | null {
  for (const assoc of associations) {
    if (assoc.source?.id === artifact.id && assoc.target && !isArtifact(assoc.target.type)) {
      return assoc.target;
    }
    if (assoc.target?.id === artifact.id && assoc.source && !isArtifact(assoc.source.type)) {
      return assoc.source;
    }
  }
  return null;
}

/**
 * Reposition artifact elements relative to their associated flow elements.
 *
 * - TextAnnotations above their linked element (via Association)
 * - DataObjectReference / DataStoreReference below their linked element
 *
 * Handles complex cases:
 * - Multiple artifacts linked to the same element (horizontal spread)
 * - Horizontal overlap between artifacts on different elements
 * - Unlinked artifacts positioned below the flow bounding box
 */

interface FlowBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface OccupiedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function computeFlowBounds(flowElements: BpmnElement[]): FlowBounds {
  let flowMaxY = ARTIFACT_SEARCH_HEIGHT;
  let flowMinY = Infinity;
  let flowMinX = Infinity;
  let flowMaxX = -Infinity;

  for (const el of flowElements) {
    const bottom = el.y + (el.height || 0);
    const right = el.x + (el.width || 0);
    if (bottom > flowMaxY) flowMaxY = bottom;
    if (el.y < flowMinY) flowMinY = el.y;
    if (el.x < flowMinX) flowMinX = el.x;
    if (right > flowMaxX) flowMaxX = right;
  }

  if (flowMinY === Infinity) flowMinY = ARTIFACT_BELOW_MIN;
  if (flowMinX === Infinity) flowMinX = ARTIFACT_ABOVE_MIN;

  return { minX: flowMinX, minY: flowMinY, maxX: flowMaxX, maxY: flowMaxY };
}

function groupArtifactsByLinkedElement(
  artifacts: BpmnElement[],
  associations: BpmnElement[]
): { linked: Map<string, BpmnElement[]>; unlinked: BpmnElement[] } {
  const artifactsByLinkedElement = new Map<string, BpmnElement[]>();
  const unlinkedArtifacts: BpmnElement[] = [];

  for (const artifact of artifacts) {
    const linkedElement = findLinkedFlowElement(artifact, associations);
    if (linkedElement) {
      const group = artifactsByLinkedElement.get(linkedElement.id) || [];
      group.push(artifact);
      artifactsByLinkedElement.set(linkedElement.id, group);
    } else {
      unlinkedArtifacts.push(artifact);
    }
  }

  return { linked: artifactsByLinkedElement, unlinked: unlinkedArtifacts };
}

function resolveOverlap(
  pos: { x: number; y: number },
  w: number,
  h: number,
  isAnnotation: boolean,
  occupiedRects: OccupiedRect[],
  flowMaxX: number
): void {
  for (const rect of occupiedRects) {
    if (
      pos.x < rect.x + rect.w &&
      pos.x + w > rect.x &&
      pos.y < rect.y + rect.h &&
      pos.y + h > rect.y
    ) {
      const rightShift = rect.x + rect.w + ARTIFACT_PADDING;
      const vertShift = isAnnotation
        ? rect.y - h - ARTIFACT_PADDING
        : rect.y + rect.h + ARTIFACT_PADDING;

      if (rightShift + w <= flowMaxX + ARTIFACT_SEARCH_HEIGHT) {
        pos.x = rightShift;
      } else {
        pos.y = vertShift;
      }
    }
  }
}

function moveArtifactIfNeeded(
  artifact: BpmnElement,
  pos: { x: number; y: number },
  modeling: Modeling
): void {
  const dx = pos.x - artifact.x;
  const dy = pos.y - artifact.y;
  if (Math.abs(dx) > MOVEMENT_THRESHOLD || Math.abs(dy) > MOVEMENT_THRESHOLD) {
    modeling.moveElements([artifact], { x: dx, y: dy });
  }
}

function positionLinkedArtifacts(
  artifactsByLinkedElement: Map<string, BpmnElement[]>,
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  occupiedRects: OccupiedRect[],
  flowMaxX: number
): void {
  for (const [linkedId, group] of artifactsByLinkedElement) {
    const linkedElement = elementRegistry.get(linkedId);
    if (!linkedElement) continue;

    const linkCx = linkedElement.x + (linkedElement.width || 0) * CENTER_FACTOR;
    const totalWidth = group.reduce(
      (sum, a) => sum + (a.width || BPMN_TASK_WIDTH) + ARTIFACT_PADDING,
      ARTIFACT_NEGATIVE_PADDING
    );
    let startX = linkCx - totalWidth * CENTER_FACTOR;

    for (const artifact of group) {
      const w = artifact.width || BPMN_TASK_WIDTH;
      const h = artifact.height || BPMN_DUMMY_HEIGHT;
      const isAnnotation = artifact.type === 'bpmn:TextAnnotation';

      const pos = {
        x: startX,
        y: isAnnotation
          ? linkedElement.y - h - ARTIFACT_ABOVE_OFFSET
          : linkedElement.y + (linkedElement.height || 0) + ARTIFACT_BELOW_OFFSET,
      };
      startX += w + ARTIFACT_PADDING;

      resolveOverlap(pos, w, h, isAnnotation, occupiedRects, flowMaxX);
      moveArtifactIfNeeded(artifact, pos, modeling);
      occupiedRects.push({ x: pos.x, y: pos.y, w, h });
    }
  }
}

function positionUnlinkedArtifacts(
  unlinkedArtifacts: BpmnElement[],
  bounds: FlowBounds,
  modeling: Modeling,
  occupiedRects: OccupiedRect[]
): void {
  let unlinkedX = bounds.minX;

  for (const artifact of unlinkedArtifacts) {
    const w = artifact.width || BPMN_TASK_WIDTH;
    const h = artifact.height || BPMN_DUMMY_HEIGHT;
    const isAnnotation = artifact.type === 'bpmn:TextAnnotation';
    const pos = {
      x: unlinkedX,
      y: isAnnotation
        ? bounds.minY - h - ARTIFACT_ABOVE_OFFSET
        : bounds.maxY + ARTIFACT_BELOW_OFFSET,
    };

    // Avoid overlap
    for (const rect of occupiedRects) {
      if (
        pos.x < rect.x + rect.w &&
        pos.x + w > rect.x &&
        pos.y < rect.y + rect.h &&
        pos.y + h > rect.y
      ) {
        pos.y = isAnnotation ? rect.y - h - ARTIFACT_PADDING : rect.y + rect.h + ARTIFACT_PADDING;
      }
    }

    moveArtifactIfNeeded(artifact, pos, modeling);
    occupiedRects.push({ x: pos.x, y: pos.y, w, h });
    unlinkedX += w + ARTIFACT_PADDING;
  }
}

const GROUP_PADDING = 20;

/**
 * Reposition a bpmn:Group to surround its layoutable children.
 * Groups are bounding boxes, not icons — placing them below the flow is wrong.
 * If the group has children that were repositioned by ELK, resize to surround
 * them. If no layoutable children, leave the group in place (skip it).
 * Returns true if the group was repositioned.
 */
function repositionGroup(group: BpmnElement, modeling: Modeling): boolean {
  const children: BpmnElement[] = ((group as any).children ?? []).filter((el: BpmnElement) =>
    isLayoutableShape(el)
  );
  if (children.length === 0) return false;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const child of children) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    const w = child.width ?? 0;
    const h = child.height ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }

  const newX = minX - GROUP_PADDING;
  const newY = minY - GROUP_PADDING;
  const newW = maxX - minX + 2 * GROUP_PADDING;
  const newH = maxY - minY + 2 * GROUP_PADDING;
  modeling.resizeShape(group, { x: newX, y: newY, width: newW, height: newH });
  return true;
}

export function repositionArtifacts(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const allArtifacts = elementRegistry.filter((el) => isArtifact(el.type));
  if (allArtifacts.length === 0) return;

  // Handle bpmn:Group elements separately:
  //   - Groups with children → resize to surround them
  //   - Groups without children → skip (don't dump them below the flow)
  // Groups are bounding boxes, not icons, so standard below/above placement is wrong.
  const artifacts = allArtifacts.filter((el) => {
    if (el.type !== 'bpmn:Group') return true;
    repositionGroup(el, modeling);
    return false; // Always exclude groups from the icon-artifact pipeline
  });
  if (artifacts.length === 0) return;

  const associations = elementRegistry.filter(
    (el) =>
      el.type === 'bpmn:Association' ||
      el.type === 'bpmn:DataInputAssociation' ||
      el.type === 'bpmn:DataOutputAssociation'
  );

  const flowElements = elementRegistry.filter((el) => !!el.type && isLayoutableShape(el));
  const bounds = computeFlowBounds(flowElements);
  const { linked, unlinked } = groupArtifactsByLinkedElement(artifacts, associations);
  const occupiedRects: OccupiedRect[] = [];

  positionLinkedArtifacts(linked, elementRegistry, modeling, occupiedRects, bounds.maxX);
  positionUnlinkedArtifacts(unlinked, bounds, modeling, occupiedRects);
}
