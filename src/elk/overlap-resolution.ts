/**
 * Post-layout overlap resolution pass.
 *
 * After ELK positioning and grid snap, elements may overlap due to
 * grid quantisation or compact spacing.  This pass detects overlapping
 * element pairs and pushes them apart vertically to eliminate overlaps.
 *
 * Boundary events are excluded — they naturally overlap their host
 * element by design.
 */

import { isConnection, isInfrastructure, isArtifact, isLane, isLayoutableShape } from './helpers';

/** Minimum gap (px) enforced between elements after overlap resolution. */
const MIN_OVERLAP_GAP = 30;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Check if two rectangles overlap (with zero tolerance). */
function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Resolve overlapping elements by pushing them apart vertically.
 *
 * Iterates through all pairs of non-connection, non-infrastructure
 * shapes and pushes overlapping ones apart.  Boundary events are
 * excluded since they naturally sit on their host's border.
 *
 * Uses a simple iterative approach: for each overlapping pair,
 * the lower element is pushed down.  Runs up to 5 iterations to
 * handle cascading overlaps.
 */
export function resolveOverlaps(elementRegistry: any, modeling: any, container?: any): void {
  const MAX_ITERATIONS = 5;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const shapes = getLayoutableShapes(elementRegistry, container);
    if (shapes.length < 2) return;

    let anyMoved = false;

    // Check all pairs for overlap
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i];
        const b = shapes[j];

        // Skip boundary-event-to-host overlaps
        if (isBoundaryHostPair(a, b)) continue;

        const rectA: Rect = { x: a.x, y: a.y, width: a.width || 0, height: a.height || 0 };
        const rectB: Rect = { x: b.x, y: b.y, width: b.width || 0, height: b.height || 0 };

        // Check both actual overlap AND insufficient vertical gap.
        // Elements that horizontally overlap but have less than MIN_OVERLAP_GAP
        // vertical separation should also be pushed apart.
        const horizontallyOverlaps =
          rectA.x < rectB.x + rectB.width && rectA.x + rectA.width > rectB.x;
        if (!horizontallyOverlaps) continue;
        if (!rectsOverlap(rectA, rectB) && !verticallyTooClose(rectA, rectB, MIN_OVERLAP_GAP)) {
          continue;
        }

        // Determine which element to push and in which direction.
        // Push the element that is lower (or to the right if same Y).
        const aCy = a.y + (a.height || 0) / 2;
        const bCy = b.y + (b.height || 0) / 2;

        let upper: any, lower: any;
        if (aCy <= bCy) {
          upper = a;
          lower = b;
        } else {
          upper = b;
          lower = a;
        }

        // Calculate how much to push the lower element down
        const upperBottom = upper.y + (upper.height || 0);
        const overlapY = upperBottom - lower.y + MIN_OVERLAP_GAP;

        if (overlapY > 0) {
          modeling.moveElements([lower], { x: 0, y: Math.round(overlapY) });
          anyMoved = true;
        }
      }
    }

    if (!anyMoved) break;
  }
}

/** Check if two elements form a boundary-event / host pair. */
function isBoundaryHostPair(a: any, b: any): boolean {
  if (a.type === 'bpmn:BoundaryEvent' && a.host?.id === b.id) return true;
  if (b.type === 'bpmn:BoundaryEvent' && b.host?.id === a.id) return true;
  return false;
}

/**
 * Check if two non-overlapping rects are vertically closer than the
 * minimum gap.  Returns true when the vertical distance between the
 * bottom of the upper rect and the top of the lower rect is less
 * than `minGap`.
 */
function verticallyTooClose(a: Rect, b: Rect, minGap: number): boolean {
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;
  // Determine which is upper vs lower
  if (a.y <= b.y) {
    const gap = b.y - aBottom;
    return gap >= 0 && gap < minGap;
  } else {
    const gap = a.y - bBottom;
    return gap >= 0 && gap < minGap;
  }
}

/** Get all shapes eligible for overlap resolution (excludes connections, infrastructure, etc.). */
function getLayoutableShapes(elementRegistry: any, container?: any): any[] {
  let parentFilter: any = container;
  if (!parentFilter) {
    parentFilter = elementRegistry.filter(
      (el: any) => el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration'
    )[0];
  }

  return elementRegistry.filter(
    (el: any) => isLayoutableShape(el) && (!parentFilter || el.parent === parentFilter)
  );
}
