/**
 * Apply ELK-computed positions and sizes to bpmn-js elements.
 */

import type { ElkNode } from 'elkjs';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import {
  isConnection as _isConnection,
  isInfrastructure as _isInfrastructure,
  isArtifact as _isArtifact,
  isLane as _isLane,
  isLayoutableShape,
} from './helpers';
import { COLLAPSED_POOL_GAP } from './constants';

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
    if (Math.abs(element.width - desiredW) > 5 || Math.abs(element.height - desiredH) > 5) {
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
  const participants = elementRegistry.filter((el) => el.type === 'bpmn:Participant');
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

    // Only shift if the offset is significant (>5px)
    if (Math.abs(dy) > 5) {
      modeling.moveElements(children, { x: 0, y: dy });
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
  const participants = elementRegistry.filter((el) => el.type === 'bpmn:Participant');
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

  // Find the bottommost expanded pool
  let maxExpandedBottom = -Infinity;
  for (const p of expanded) {
    const bottom = p.y + (p.height || 0);
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
    if (p.x < expandedMinX) expandedMinX = p.x;
    const right = p.x + (p.width || 0);
    if (right > expandedMaxRight) expandedMaxRight = right;
  }
  const expandedWidth = expandedMaxRight - expandedMinX;

  // Sort collapsed pools by current Y for stable ordering
  collapsed.sort((a, b) => a.y - b.y);

  for (const pool of collapsed) {
    // Snap x/width to match expanded pool edges
    const dx = Math.round(expandedMinX - pool.x);
    const dy = Math.round(nextY - pool.y);
    const needsMove = Math.abs(dx) > 2 || (pool.y < nextY && Math.abs(dy) > 2);

    if (needsMove) {
      modeling.moveElements([pool], {
        x: Math.abs(dx) > 2 ? dx : 0,
        y: pool.y < nextY && Math.abs(dy) > 2 ? dy : 0,
      });
    }

    // Resize width to match expanded pool span
    const currentPool = elementRegistry.get(pool.id)!;
    if (Math.abs((currentPool.width || 0) - expandedWidth) > 5) {
      modeling.resizeShape(currentPool, {
        x: currentPool.x,
        y: currentPool.y,
        width: expandedWidth,
        height: currentPool.height || 60,
      });
    }

    // Advance nextY for multiple collapsed pools
    const updatedPool = elementRegistry.get(pool.id)!;
    nextY = updatedPool.y + (updatedPool.height || 0) + POOL_GAP;
  }
}
