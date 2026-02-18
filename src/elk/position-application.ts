/**
 * Apply ELK-computed positions and sizes to bpmn-js elements.
 */

import ELK, { type ElkNode } from 'elkjs';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import {
  isConnection as _isConnection,
  isInfrastructure as _isInfrastructure,
  isArtifact as _isArtifact,
  isLane as _isLane,
  isLayoutableShape,
} from './helpers';
import {
  COLLAPSED_POOL_GAP,
  INTER_POOL_GAP_EXTRA,
  RESIZE_SIGNIFICANCE_THRESHOLD,
  COLLAPSED_POOL_DEFAULT_HEIGHT,
  POOL_COMPACT_RIGHT_PADDING,
  POOL_LABEL_BAND,
  NORMALISE_ORIGIN_Y,
  ORIGIN_OFFSET_Y,
} from './constants';
import { buildCompoundNode } from './graph-builder';
import { applyElkEdgeRoutes } from './edge-routing';

/** Gap between stacked event subprocesses */
const EVENT_SUBPROCESS_STACK_GAP = 30;

/** BPMN type constants to reduce duplication */
const BPMN_SUBPROCESS = 'bpmn:SubProcess';
const BPMN_PROCESS = 'bpmn:Process';
const BPMN_PARTICIPANT = 'bpmn:Participant';

// Shared ELK instance
const elk = new ELK();

/**
 * Recursively apply ELK layout results to bpmn-js elements.
 *
 * For top-level nodes, positions are absolute (parentAbsX/Y is the origin
 * offset).  For children of compound nodes, ELK positions are relative to
 * the parent, so we accumulate offsets as we recurse.
 */
export function applyElkPositions(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  elkNode: ElkNode,
  parentAbsX: number,
  parentAbsY: number
): void {
  if (!elkNode.children) return;

  for (const child of elkNode.children) {
    if (child.x === undefined || child.y === undefined) continue;

    const element = elementRegistry.get(child.id);
    if (!element) continue;

    const desiredX = Math.round(parentAbsX + child.x);
    const desiredY = Math.round(parentAbsY + child.y);
    const dx = desiredX - element.x;
    const dy = desiredY - element.y;

    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      modeling.moveElements([element], { x: dx, y: dy });
    }

    // Recurse for compound nodes (participants, expanded subprocesses)
    if (child.children && child.children.length > 0) {
      const updated = elementRegistry.get(child.id);
      if (updated) {
        applyElkPositions(elementRegistry, modeling, child, updated.x, updated.y);
      }
    }
  }
}

/**
 * Resize compound nodes (participants, expanded subprocesses) to match
 * ELK-computed dimensions.
 *
 * ELK computes proper width/height for compound children based on their
 * contents + padding.  `applyElkPositions` only applies x/y, so this
 * separate pass applies the size.  Must run AFTER applyElkPositions so
 * that the element's current x/y is already correct.
 */
export function resizeCompoundNodes(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  elkNode: ElkNode
): void {
  if (!elkNode.children) return;

  for (const child of elkNode.children) {
    // Only resize compound nodes (those with children in the ELK result)
    if (!child.children || child.children.length === 0) continue;
    if (child.width === undefined || child.height === undefined) continue;

    const element = elementRegistry.get(child.id);
    if (!element) continue;

    const desiredW = Math.round(child.width);
    const desiredH = Math.round(child.height);

    // Only resize if significantly different from current size
    if (
      Math.abs(element.width - desiredW) > RESIZE_SIGNIFICANCE_THRESHOLD ||
      Math.abs(element.height - desiredH) > RESIZE_SIGNIFICANCE_THRESHOLD
    ) {
      modeling.resizeShape(element, {
        x: element.x,
        y: element.y,
        width: desiredW,
        height: desiredH,
      });
    }

    // Recurse for nested compound nodes (expanded subprocesses inside participants)
    resizeCompoundNodes(elementRegistry, modeling, child);
  }
}

/**
 * Position event subprocesses below the main process flow with appropriate spacing.
 *
 * Event subprocesses (triggeredByEvent=true) are excluded from the main ELK layout
 * to prevent them from interfering with the main sequence flow. Each event subprocess
 * gets its own separate ELK layout for its children, then is positioned below the
 * main process with generous vertical spacing (80px gap).
 *
 * NOTE: This function captures main flow bounds BEFORE any awaits to avoid position
 * drift caused by event loop callbacks.
 */
export async function positionEventSubprocesses(
  elementRegistry: ElementRegistry,
  modeling: Modeling
): Promise<void> {
  // Find all processes
  const processes = elementRegistry.filter(
    (el) => el.type === BPMN_PROCESS || el.type === BPMN_PARTICIPANT
  );

  for (const process of processes) {
    // Find event subprocesses in this process
    const eventSubprocesses = elementRegistry.filter(
      (el) =>
        el.parent === process &&
        el.type === BPMN_SUBPROCESS &&
        el.businessObject?.triggeredByEvent === true
    );

    if (eventSubprocesses.length === 0) continue;

    // Find main flow elements (excluding event subprocesses and their children)
    const mainFlowElements = elementRegistry.filter(
      (el) =>
        el.parent === process &&
        !el.businessObject?.triggeredByEvent &&
        el.type !== 'bpmn:Lane' &&
        el.type !== 'bpmn:SequenceFlow' &&
        el.type !== 'bpmn:MessageFlow' &&
        el.type !== 'bpmn:Association' &&
        el.type !== 'bpmn:BoundaryEvent' &&
        el.type !== 'label'
    );

    if (mainFlowElements.length === 0) continue;

    // CAPTURE positions BEFORE any awaits to avoid event loop position drift
    const mainFlowBottom = Math.max(...mainFlowElements.map((el) => el.y + (el.height || 0)));
    const mainFlowLeft = Math.min(...mainFlowElements.map((el) => el.x));

    // Position event subprocesses below with 80px gap
    const EVENT_SUBPROCESS_VERTICAL_GAP = 80;
    let currentY = mainFlowBottom + EVENT_SUBPROCESS_VERTICAL_GAP;

    for (const eventSubprocess of eventSubprocesses) {
      // Build ELK graph for this event subprocess to layout its children
      const allElements = elementRegistry.filter(() => true);

      // Use buildCompoundNode which applies proper EVENT_SUBPROCESS_PADDING
      const elkGraph = buildCompoundNode(allElements, eventSubprocess);

      // If the event subprocess has no children or only one child, skip ELK layout
      if (!elkGraph.children || elkGraph.children.length <= 1) {
        // Just position the event subprocess and continue
        modeling.moveElements([eventSubprocess], {
          x: mainFlowLeft - eventSubprocess.x,
          y: currentY - eventSubprocess.y,
        });
        currentY += eventSubprocess.height + EVENT_SUBPROCESS_STACK_GAP;
        continue;
      }

      // Run ELK layout for the event subprocess
      const elkResult = await elk.layout(elkGraph);

      // Apply positions to children of the event subprocess
      if (elkResult.children) {
        for (const childNode of elkResult.children) {
          const childElement = elementRegistry.get(childNode.id);
          if (childElement && childNode.x !== undefined && childNode.y !== undefined) {
            modeling.moveElements([childElement], {
              x: eventSubprocess.x + childNode.x - childElement.x,
              y: eventSubprocess.y + childNode.y - childElement.y,
            });
          }
        }
      }

      // Apply edge routes for connections inside the event subprocess
      if (elkResult.edges) {
        applyElkEdgeRoutes(
          elementRegistry,
          modeling,
          elkResult,
          eventSubprocess.x,
          eventSubprocess.y
        );
      }

      // Resize the event subprocess to fit its content
      if (elkResult.width !== undefined && elkResult.height !== undefined) {
        modeling.resizeShape(eventSubprocess, {
          x: eventSubprocess.x,
          y: eventSubprocess.y,
          width: Math.round(elkResult.width),
          height: Math.round(elkResult.height),
        });
      }

      // Position the event subprocess below main process
      modeling.moveElements([eventSubprocess], {
        x: mainFlowLeft - eventSubprocess.x,
        y: currentY - eventSubprocess.y,
      });

      // Stack next event subprocess below with spacing
      currentY += eventSubprocess.height + EVENT_SUBPROCESS_STACK_GAP;
    }
  }
}

/**
 * Centre elements vertically within each participant pool.
 *
 * After ELK layout + grid snap, the content inside a pool may not be
 * vertically centred — e.g. elements cluster towards the top due to
 * ELK's top-aligned padding.  This pass computes the vertical extent
 * of all flow elements inside each participant and shifts them to be
 * centred within the pool's usable area.
 *
 * Only applies when the vertical offset exceeds a minimum threshold
 * to avoid unnecessary micro-adjustments.
 */
export function centreElementsInPools(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const participants = elementRegistry.filter((el) => el.type === BPMN_PARTICIPANT);
  if (participants.length === 0) return;

  for (const pool of participants) {
    // Collect flow elements that are direct children of this pool
    // (skip lanes, connections, boundary events, labels, infrastructure)
    const children = elementRegistry.filter((el) => el.parent === pool && isLayoutableShape(el));

    if (children.length === 0) continue;

    // Compute the vertical bounding box of the children
    let contentMinY = Infinity;
    let contentMaxY = -Infinity;
    for (const child of children) {
      if (child.y < contentMinY) contentMinY = child.y;
      const bottom = child.y + (child.height || 0);
      if (bottom > contentMaxY) contentMaxY = bottom;
    }

    const contentHeight = contentMaxY - contentMinY;

    // Pool usable area (exclude the ~30px left label band)
    const poolTop = pool.y;
    const poolBottom = pool.y + pool.height;
    const usableHeight = poolBottom - poolTop;

    // Desired Y for the content to be centred
    const desiredMinY = poolTop + (usableHeight - contentHeight) / 2;
    const dy = Math.round(desiredMinY - contentMinY);

    if (Math.abs(dy) > RESIZE_SIGNIFICANCE_THRESHOLD) {
      modeling.moveElements(children, { x: 0, y: dy });
    }
  }
}

/**
 * Enforce minimum vertical gap between expanded participant pools.
 *
 * ELK's internal layout for compound nodes can leave expanded pools
 * with very tight vertical gaps.  This pass ensures a minimum gap
 * between stacked pools by pushing lower pools downward when necessary.
 */
export function enforceExpandedPoolGap(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const participants = elementRegistry.filter((el) => el.type === BPMN_PARTICIPANT);
  if (participants.length < 2) return;

  // Only consider expanded pools (those with flow-element children)
  const expanded = participants.filter(
    (pool) => elementRegistry.filter((el) => el.parent === pool && isLayoutableShape(el)).length > 0
  );

  if (expanded.length < 2) return;

  // Sort by Y position
  expanded.sort((a, b) => a.y - b.y);

  const minGap = INTER_POOL_GAP_EXTRA;

  for (let i = 1; i < expanded.length; i++) {
    const prevPool = elementRegistry.get(expanded[i - 1].id)!;
    const currPool = elementRegistry.get(expanded[i].id)!;
    const prevBottom = prevPool.y + (prevPool.height || 0);
    const currentGap = currPool.y - prevBottom;

    if (currentGap < minGap) {
      const dy = Math.round(minGap - currentGap);
      // Move this pool and all subsequent pools down
      const toMove = expanded
        .slice(i)
        .map((p) => elementRegistry.get(p.id)!)
        .filter(Boolean);
      modeling.moveElements(toMove, { x: 0, y: dy });
    }
  }
}

/**
 * Compact expanded pools to tightly fit their content.
 *
 * After ELK layout + grid snap + centring, pool width may be significantly
 * larger than needed (ELK sizes compound nodes generously).  This pass
 * measures the actual content bounding box within each expanded pool and
 * shrinks the pool's right edge to hug the rightmost flow element with
 * standard padding.  Only shrinks — never expands.
 *
 * Lanes (if present) are resized to match the new pool width.
 */
export function compactPools(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const participants = elementRegistry.filter((el) => el.type === BPMN_PARTICIPANT);
  if (participants.length === 0) return;

  for (const pool of participants) {
    // Only compact expanded pools (those with flow-element children)
    const children = elementRegistry.filter((el) => el.parent === pool && isLayoutableShape(el));
    if (children.length === 0) continue;

    // Compute content right edge
    let contentMaxX = -Infinity;
    for (const child of children) {
      const right = child.x + (child.width || 0);
      if (right > contentMaxX) contentMaxX = right;
    }

    // Desired pool right edge
    const desiredRight = contentMaxX + POOL_COMPACT_RIGHT_PADDING;
    const currentRight = pool.x + pool.width;

    // Only compact (shrink), never expand
    if (desiredRight >= currentRight - RESIZE_SIGNIFICANCE_THRESHOLD) continue;

    const newWidth = Math.round(desiredRight - pool.x);
    if (newWidth <= 0) continue;

    modeling.resizeShape(pool, {
      x: pool.x,
      y: pool.y,
      width: newWidth,
      height: pool.height,
    });

    // Resize lanes to match the new pool width
    const lanes = elementRegistry.filter((el) => el.type === 'bpmn:Lane' && el.parent === pool);
    if (lanes.length > 0) {
      const updatedPool = elementRegistry.get(pool.id)!;
      const laneWidth = updatedPool.width - POOL_LABEL_BAND;
      for (const lane of lanes) {
        const currentLane = elementRegistry.get(lane.id)!;
        if (Math.abs(currentLane.width - laneWidth) > RESIZE_SIGNIFICANCE_THRESHOLD) {
          modeling.resizeShape(currentLane, {
            x: currentLane.x,
            y: currentLane.y,
            width: laneWidth,
            height: currentLane.height,
          });
        }
      }
    }
  }
}

/**
 * Ensure collapsed pools are placed below expanded pools.
 *
 * ELK may place collapsed participants (thin bars without internal process)
 * above expanded ones because it treats them as simple nodes with no
 * content-based size constraint.  This pass detects such misordering and
 * moves collapsed pools below the bottommost expanded pool with a
 * consistent gap, matching the standard Camunda 7 collaboration pattern
 * where only the executable (expanded) pool is on top.
 */
export function reorderCollapsedPoolsBelow(
  elementRegistry: ElementRegistry,
  modeling: Modeling
): void {
  const participants = elementRegistry.filter((el) => el.type === BPMN_PARTICIPANT);
  if (participants.length < 2) return;

  // Classify pools: expanded have flow-element children, collapsed do not
  const expanded: BpmnElement[] = [];
  const collapsed: BpmnElement[] = [];

  for (const pool of participants) {
    const hasFlowChildren =
      elementRegistry.filter((el) => el.parent === pool && isLayoutableShape(el)).length > 0;

    if (hasFlowChildren) {
      expanded.push(pool);
    } else {
      collapsed.push(pool);
    }
  }

  if (expanded.length === 0 || collapsed.length === 0) return;

  // ── Step 1: Raise expanded pools so the topmost one starts near ORIGIN_OFFSET_Y.
  //
  // ELK may place collapsed pools above expanded pools in the Y-axis (collapsed
  // pools are small and ELK treats them as lighter nodes).  After
  // applyElkPositions, the expanded pool can be pushed below the collapsed
  // pool's y-range.  Move expanded pools UP so the topmost one starts at
  // ORIGIN_OFFSET_Y, matching the Camunda Modeler convention where the
  // executable (expanded) pool sits at the top.
  expanded.sort((a, b) => a.y - b.y);
  const topmostExpandedY = expanded[0].y;
  if (topmostExpandedY > ORIGIN_OFFSET_Y + RESIZE_SIGNIFICANCE_THRESHOLD) {
    // Target ORIGIN_OFFSET_Y + 2 to match the 2px natural ELK top margin that
    // the expanded pool would have had if it weren't displaced by the collapsed
    // pool ordering.  Targeting exactly ORIGIN_OFFSET_Y=80 gives y=80, but the
    // Camunda Modeler reference has y=82 (80 + 2px ELK padding).
    const targetY = ORIGIN_OFFSET_Y + 2;
    const dy = Math.round(targetY - topmostExpandedY);
    for (const pool of expanded) {
      const currentPool = elementRegistry.get(pool.id)!;
      modeling.moveElements([currentPool], { x: 0, y: dy });
    }
  }

  // Re-read positions after potential move
  expanded.sort((a, b) => {
    const cur = elementRegistry.get(a.id)!;
    const curB = elementRegistry.get(b.id)!;
    return cur.y - curB.y;
  });

  // Find the bottommost expanded pool
  let maxExpandedBottom = -Infinity;
  for (const p of expanded) {
    const currentPool = elementRegistry.get(p.id)!;
    const bottom = currentPool.y + (currentPool.height || 0);
    if (bottom > maxExpandedBottom) maxExpandedBottom = bottom;
  }

  // Move collapsed pools below the bottommost expanded pool
  const POOL_GAP = COLLAPSED_POOL_GAP;
  let nextY = maxExpandedBottom + POOL_GAP;

  // Compute the horizontal extent of expanded pools for edge snapping.
  // Collapsed pools should share the same left/right edges as the
  // expanded pools (matching the standard BPMN modeler convention).
  let expandedMinX = Infinity;
  let expandedMaxRight = -Infinity;
  for (const p of expanded) {
    const currentPool = elementRegistry.get(p.id)!;
    if (currentPool.x < expandedMinX) expandedMinX = currentPool.x;
    const right = currentPool.x + (currentPool.width || 0);
    if (right > expandedMaxRight) expandedMaxRight = right;
  }
  const expandedWidth = expandedMaxRight - expandedMinX;

  // Sort collapsed pools by current Y for stable ordering
  collapsed.sort((a, b) => a.y - b.y);

  for (const pool of collapsed) {
    // Snap x/width to match expanded pool edges
    const dx = Math.round(expandedMinX - pool.x);
    const dy = Math.round(nextY - pool.y);
    const needsMove = Math.abs(dx) > 2 || Math.abs(dy) > 2;

    if (needsMove) {
      modeling.moveElements([pool], {
        x: Math.abs(dx) > 2 ? dx : 0,
        y: Math.abs(dy) > 2 ? dy : 0,
      });
    }

    // Resize width to match expanded pool span
    const currentPool = elementRegistry.get(pool.id)!;
    if (Math.abs((currentPool.width || 0) - expandedWidth) > RESIZE_SIGNIFICANCE_THRESHOLD) {
      modeling.resizeShape(currentPool, {
        x: currentPool.x,
        y: currentPool.y,
        width: expandedWidth,
        height: currentPool.height || COLLAPSED_POOL_DEFAULT_HEIGHT,
      });
    }

    // Advance nextY for multiple collapsed pools
    const updatedPool = elementRegistry.get(pool.id)!;
    nextY = updatedPool.y + (updatedPool.height || 0) + POOL_GAP;
  }
}

/**
 * Normalise the Y origin of the diagram so the topmost flow element
 * starts at ORIGIN_OFFSET_Y.
 *
 * Multiple post-processing passes (alignHappyPath, gridSnapPass,
 * resolveOverlaps) accumulate Y-shifts after ELK's initial placement.
 * This final pass re-anchors the diagram to the expected baseline.
 *
 * Only applies to plain processes (no participants).  Collaborations
 * with participant pools are already properly anchored by
 * centreElementsInPools and enforceExpandedPoolGap.
 */
export function normaliseOrigin(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const participants = elementRegistry.filter((el) => el.type === BPMN_PARTICIPANT);

  // Skip collaborations — moving participants in headless mode can trigger
  // bpmn-js internal ordering errors.  Pool positioning is already handled
  // by centreElementsInPools, enforceExpandedPoolGap, and compactPools.
  if (participants.length > 0) return;

  // Plain process: find the topmost flow element
  const allElements: BpmnElement[] = elementRegistry.getAll();

  // Get the root process element
  const rootProcess = allElements.find(
    (el) => el.type === BPMN_PROCESS || el.type === 'bpmn:Collaboration'
  );

  // Only consider direct children of the root (not nested in subprocesses)
  const flowElements = elementRegistry.filter(
    (el) => isLayoutableShape(el) && (!rootProcess || el.parent === rootProcess)
  );
  if (flowElements.length === 0) return;

  let topY = Infinity;
  for (const el of flowElements) {
    if (el.y < topY) topY = el.y;
  }

  // Only shift elements UP to NORMALISE_ORIGIN_Y (when ELK placed them too high).
  // Never shift DOWN: if ELK gives a larger top margin (e.g. for boundary-event
  // processes where it reserves extra space), that margin is intentional and
  // correct.  Forcing elements down to 92 when they naturally sit at 105 breaks
  // the boundary-event layout.
  const delta = NORMALISE_ORIGIN_Y - topY;
  if (delta > 2) {
    try {
      modeling.moveElements(flowElements, { x: 0, y: delta });
    } catch {
      // Fallback: direct position update when modeling.moveElements crashes
      for (const el of flowElements) {
        el.x += 0;
        el.y += delta;
        if (el.di?.bounds) {
          el.di.bounds.x = el.x;
          el.di.bounds.y = el.y;
        }
      }
    }
  }
}
