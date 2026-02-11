/**
 * Post-layout artifact repositioning.
 *
 * Artifacts (DataObjectReference, DataStoreReference, TextAnnotation) are
 * excluded from the ELK graph.  This module repositions them relative to
 * their associated flow elements after layout.
 */

import { ARTIFACT_BELOW_OFFSET, ARTIFACT_ABOVE_OFFSET } from './constants';
import { isConnection, isInfrastructure, isArtifact, isLayoutableShape } from './helpers';

/**
 * Find the flow element linked to an artifact via an association.
 */
function findLinkedFlowElement(artifact: any, associations: any[]): any {
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

export function repositionArtifacts(elementRegistry: any, modeling: any): void {
  const artifacts = elementRegistry.filter((el: any) => isArtifact(el.type));
  if (artifacts.length === 0) return;

  const associations = elementRegistry.filter(
    (el: any) =>
      el.type === 'bpmn:Association' ||
      el.type === 'bpmn:DataInputAssociation' ||
      el.type === 'bpmn:DataOutputAssociation'
  );

  // Compute flow bounding box (for unlinked artifact fallback)
  const flowElements = elementRegistry.filter((el: any) => el.type && isLayoutableShape(el));
  let flowMaxY = 200;
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
  if (flowMinY === Infinity) flowMinY = 80;
  if (flowMinX === Infinity) flowMinX = 150;

  // Group artifacts by their linked element to handle multiple artifacts per element
  const artifactsByLinkedElement = new Map<string, any[]>();
  const unlinkedArtifacts: any[] = [];

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

  const occupiedRects: Array<{ x: number; y: number; w: number; h: number }> = [];

  // Position linked artifacts — spread horizontally when multiple share the same element
  for (const [linkedId, group] of artifactsByLinkedElement) {
    const linkedElement = elementRegistry.get(linkedId);
    if (!linkedElement) continue;

    const linkCx = linkedElement.x + (linkedElement.width || 0) / 2;
    const totalWidth = group.reduce((sum: number, a: any) => sum + (a.width || 100) + 20, -20);
    let startX = linkCx - totalWidth / 2;

    for (const artifact of group) {
      const w = artifact.width || 100;
      const h = artifact.height || 30;
      const isAnnotation = artifact.type === 'bpmn:TextAnnotation';

      const pos = {
        x: startX,
        y: isAnnotation
          ? linkedElement.y - h - ARTIFACT_ABOVE_OFFSET
          : linkedElement.y + (linkedElement.height || 0) + ARTIFACT_BELOW_OFFSET,
      };
      startX += w + 20;

      // Avoid overlap with previously placed artifacts (both vertical and horizontal)
      for (const rect of occupiedRects) {
        if (
          pos.x < rect.x + rect.w &&
          pos.x + w > rect.x &&
          pos.y < rect.y + rect.h &&
          pos.y + h > rect.y
        ) {
          // Try shifting horizontally first, then vertically
          const rightShift = rect.x + rect.w + 20;
          const vertShift = isAnnotation ? rect.y - h - 20 : rect.y + rect.h + 20;

          if (rightShift + w <= flowMaxX + 200) {
            pos.x = rightShift;
          } else {
            pos.y = vertShift;
          }
        }
      }

      const dx = pos.x - artifact.x;
      const dy = pos.y - artifact.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        modeling.moveElements([artifact], { x: dx, y: dy });
      }

      occupiedRects.push({ x: pos.x, y: pos.y, w, h });
    }
  }

  // Position unlinked artifacts outside the flow bounding box
  let unlinkedX = flowMinX;
  for (const artifact of unlinkedArtifacts) {
    const w = artifact.width || 100;
    const h = artifact.height || 30;
    const isAnnotation = artifact.type === 'bpmn:TextAnnotation';
    const pos = {
      x: unlinkedX,
      y: isAnnotation ? flowMinY - h - ARTIFACT_ABOVE_OFFSET : flowMaxY + ARTIFACT_BELOW_OFFSET,
    };

    // Avoid overlap
    for (const rect of occupiedRects) {
      if (
        pos.x < rect.x + rect.w &&
        pos.x + w > rect.x &&
        pos.y < rect.y + rect.h &&
        pos.y + h > rect.y
      ) {
        pos.y = isAnnotation ? rect.y - h - 20 : rect.y + rect.h + 20;
      }
    }

    const dx = pos.x - artifact.x;
    const dy = pos.y - artifact.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      modeling.moveElements([artifact], { x: dx, y: dy });
    }

    occupiedRects.push({ x: pos.x, y: pos.y, w, h });
    unlinkedX += w + 20;
  }
}
