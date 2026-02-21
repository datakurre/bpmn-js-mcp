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

import {
  isConnection as _isConnection,
  isInfrastructure as _isInfrastructure,
  isArtifact as _isArtifact,
  isLane as _isLane,
  isLayoutableShape,
} from './helpers';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { type Rect, rectsOverlap } from '../geometry';
import { MIN_OVERLAP_GAP, OVERLAP_MAX_ITERATIONS, COLUMN_PROXIMITY } from './constants';
import { SpatialGrid } from './spatial-index';

/**
 * Resolve overlapping elements by pushing them apart vertically.
 *
 * H2: Uses a spatial grid index to reduce the O(n²) all-pairs comparison
 * to O(n × k) where k is the average number of neighbours per grid cell.
 * For diagrams with 50+ elements this typically reduces the comparison
 * count by 10–50×, with no change to correctness.
 *
 * Iterates through all non-connection, non-infrastructure shapes and
 * pushes overlapping ones apart.  Boundary events are excluded since
 * they naturally sit on their host's border.
 *
 * Uses a simple iterative approach: for each overlapping pair,
 * the lower element is pushed down.  Runs up to 5 iterations to
 * handle cascading overlaps.
 */
export function resolveOverlaps(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  container?: BpmnElement
): void {
  for (let iter = 0; iter < OVERLAP_MAX_ITERATIONS; iter++) {
    const shapes = getLayoutableShapes(elementRegistry, container);
    if (shapes.length < 2) return;

    // H2: Build a spatial grid index so we only compare pairs whose
    // bounding boxes share grid cells, rather than all-pairs.
    // Cell size ~3× element height gives each element ~4–9 neighbours
    // on average for typical BPMN diagrams.
    const grid = new SpatialGrid(300, 300);
    for (const shape of shapes) {
      grid.add(shape);
    }

    let anyMoved = false;

    for (const a of shapes) {
      const rectA: Rect = { x: a.x, y: a.y, width: a.width || 0, height: a.height || 0 };

      // Only consider candidates in nearby grid cells — O(k) per element
      // instead of O(n). The +MIN_OVERLAP_GAP expansion catches pairs that
      // are close but not yet overlapping (verticallyTooClose check below).
      const candidates = grid.getCandidatesExpanded(rectA, MIN_OVERLAP_GAP, a.id);

      for (const { element: b } of candidates) {
        // Only process each pair once (a.id < b.id ordering)
        if (a.id >= b.id) continue;

        // Skip boundary-event-to-host overlaps
        if (isBoundaryHostPair(a, b)) continue;

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
        //
        // Fix 3b — horizontal push for connected elements in the same column:
        // If elements A and B are connected by a sequence flow (A→B or B→A)
        // and their X-centres are within COLUMN_PROXIMITY of each other, they
        // have been collapsed into the same grid column by the snap pass, but
        // should be in adjacent columns (B to the right of A).  Push the
        // downstream element rightward instead of downward so alignHappyPath
        // cannot pull it back to the happy-path row and recreate the overlap.
        const aCx = a.x + (a.width || 0) / 2;
        const bCx = b.x + (b.width || 0) / 2;
        const sameColumn = Math.abs(aCx - bCx) < COLUMN_PROXIMITY;

        let pushedHorizontally = false;
        if (sameColumn) {
          const aConnectsToB = (
            a.outgoing as Array<{ target?: { id: string }; type: string }> | undefined
          )?.some((flow) => flow.type === 'bpmn:SequenceFlow' && flow.target?.id === b.id);
          const bConnectsToA = (
            b.outgoing as Array<{ target?: { id: string }; type: string }> | undefined
          )?.some((flow) => flow.type === 'bpmn:SequenceFlow' && flow.target?.id === a.id);

          if (aConnectsToB || bConnectsToA) {
            // a is upstream of b (or vice-versa) — push downstream element right
            const upstream = aConnectsToB ? a : b;
            const downstream = aConnectsToB ? b : a;
            const upstreamRight = upstream.x + (upstream.width || 0);
            const overlapX = upstreamRight - downstream.x + MIN_OVERLAP_GAP;
            if (overlapX > 0) {
              modeling.moveElements([downstream], { x: Math.round(overlapX), y: 0 });
              grid.update(downstream);
              anyMoved = true;
              pushedHorizontally = true;
            }
          }
        }

        if (!pushedHorizontally) {
          // Vertical push: push the element that is lower (or to the right if same Y).
          const aCy = a.y + (a.height || 0) / 2;
          const bCy = b.y + (b.height || 0) / 2;

          let upper: BpmnElement, lower: BpmnElement;
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
            // Update the grid after the move so subsequent candidates in this
            // iteration see the correct position.
            grid.update(lower);
            anyMoved = true;
          }
        }
      }
    }

    if (!anyMoved) break;
  }
}

/** Check if two elements form a boundary-event / host pair. */
function isBoundaryHostPair(a: BpmnElement, b: BpmnElement): boolean {
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
function getLayoutableShapes(
  elementRegistry: ElementRegistry,
  container?: BpmnElement
): BpmnElement[] {
  let parentFilter: BpmnElement | undefined = container;
  if (!parentFilter) {
    parentFilter = elementRegistry.filter(
      (el) => el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration'
    )[0];
  }

  return elementRegistry.filter(
    (el) => isLayoutableShape(el) && (!parentFilter || el.parent === parentFilter)
  );
}
