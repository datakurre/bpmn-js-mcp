/**
 * Positioning helpers for add-element: shift downstream elements,
 * resize containers, lane detection and snapping.
 *
 * Split from add-element.ts for file-size compliance.
 */

import { getVisibleElements, requireElement } from '../helpers';
import { getService } from '../../bpmn-types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { STANDARD_BPMN_GAP } from '../../constants';

/** BPMN type string constants for filtering and type checking. */
const BPMN_PARTICIPANT_TYPE = 'bpmn:Participant';
const BPMN_LANE_TYPE = 'bpmn:Lane';

/**
 * Shift all non-flow elements at or to the right of `fromX` by `shiftAmount`,
 * excluding `excludeId`.  This prevents overlap when inserting a new element.
 */
export function shiftDownstreamElements(
  elementRegistry: any,
  modeling: any,
  fromX: number,
  shiftAmount: number,
  excludeId: string
): void {
  const allElements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== BPMN_PARTICIPANT_TYPE &&
      el.type !== BPMN_LANE_TYPE &&
      el.id !== excludeId
  );
  const toShift = allElements.filter((el: any) => el.x >= fromX);
  for (const el of toShift) {
    modeling.moveElements([el], { x: shiftAmount, y: 0 });
  }

  resizeParentContainers(elementRegistry, modeling);
}

// ── Parent container resizing ───────────────────────────────────────────────

/** Resize a single participant pool to contain all direct children with padding. */
function resizePool(pool: any, elementRegistry: any, modeling: any): void {
  const children = elementRegistry.filter(
    (el: any) =>
      el.parent === pool &&
      el.type !== BPMN_LANE_TYPE &&
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association')
  );
  if (children.length === 0) return;

  let maxRight = 0;
  for (const child of children) {
    const right = child.x + (child.width || 0);
    if (right > maxRight) maxRight = right;
  }

  const poolRight = pool.x + (pool.width || 0);
  const padding = 50;
  if (maxRight + padding > poolRight) {
    modeling.resizeShape(pool, {
      x: pool.x,
      y: pool.y,
      width: maxRight - pool.x + padding,
      height: pool.height || 250,
    });
  }
}

/** Resize lanes inside a pool to match the pool's current width. */
function resizeLanes(pool: any, elementRegistry: any, modeling: any): void {
  const lanes = elementRegistry.filter(
    (el: any) => el.type === BPMN_LANE_TYPE && el.parent === pool
  );
  const poolWidth = pool.width || 600;
  for (const lane of lanes) {
    if (lane.width !== poolWidth - 30) {
      modeling.resizeShape(lane, {
        x: lane.x,
        y: lane.y,
        width: poolWidth - 30,
        height: lane.height || 125,
      });
    }
  }
}

/** Resize an expanded subprocess to contain all its children. */
function resizeSubprocess(sp: any, elementRegistry: any, modeling: any): void {
  const children = elementRegistry.filter(
    (el: any) =>
      el.parent === sp &&
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'label'
  );
  if (children.length === 0) return;

  let maxRight = 0;
  let maxBottom = 0;
  for (const child of children) {
    const right = child.x + (child.width || 0);
    const bottom = child.y + (child.height || 0);
    if (right > maxRight) maxRight = right;
    if (bottom > maxBottom) maxBottom = bottom;
  }

  const padding = 40;
  const spRight = sp.x + (sp.width || 0);
  const spBottom = sp.y + (sp.height || 0);
  const needsWidthGrow = maxRight + padding > spRight;
  const needsHeightGrow = maxBottom + padding > spBottom;

  if (needsWidthGrow || needsHeightGrow) {
    modeling.resizeShape(sp, {
      x: sp.x,
      y: sp.y,
      width: needsWidthGrow ? maxRight - sp.x + padding : sp.width || 350,
      height: needsHeightGrow ? maxBottom - sp.y + padding : sp.height || 200,
    });
  }
}

/**
 * Resize participant pools, lanes, and expanded subprocesses that are too
 * narrow/short after elements were shifted right.
 *
 * C1-5: Extends pool resizing to also cover expanded subprocesses, so that
 * downstream-shifted child elements remain within their parent container.
 */
export function resizeParentContainers(elementRegistry: any, modeling: any): void {
  const participants = elementRegistry.filter((el: any) => el.type === BPMN_PARTICIPANT_TYPE);
  for (const pool of participants) {
    resizePool(pool, elementRegistry, modeling);
    resizeLanes(pool, elementRegistry, modeling);
  }

  // C1-5: Also resize expanded SubProcesses whose children have shifted past the right edge.
  const subprocesses = elementRegistry.filter(
    (el: any) => el.type === 'bpmn:SubProcess' && el.collapsed !== true
  );
  for (const sp of subprocesses) {
    resizeSubprocess(sp, elementRegistry, modeling);
  }
}

/**
 * Find the lane that contains a given (x, y) coordinate.
 */
function findContainingLane(elementRegistry: any, x: number, y: number): any {
  const lanes = elementRegistry.filter((el: any) => el.type === BPMN_LANE_TYPE);
  for (const lane of lanes) {
    const lx = lane.x ?? 0;
    const ly = lane.y ?? 0;
    const lw = lane.width ?? 0;
    const lh = lane.height ?? 0;
    if (x >= lx && x <= lx + lw && y >= ly && y <= ly + lh) return lane;
  }
  return undefined;
}

/**
 * Snap a Y coordinate into a lane's vertical boundaries if lanes exist.
 */
export function snapToLane(
  elementRegistry: any,
  x: number,
  y: number,
  elementHeight: number
): { y: number; laneId?: string } {
  const lane = findContainingLane(elementRegistry, x, y);
  if (!lane) return { y };

  const laneTop = lane.y ?? 0;
  const laneBottom = laneTop + (lane.height ?? 0);
  const halfH = elementHeight / 2;

  let snappedY = y;
  if (y - halfH < laneTop) snappedY = laneTop + halfH + 5;
  if (y + halfH > laneBottom) snappedY = laneBottom - halfH - 5;

  return { y: snappedY, laneId: lane.id };
}

export interface HostInfo {
  hostElementId: string;
  hostElementType: string;
  hostElementName?: string;
}

/**
 * Collision-avoidance: shift position so the new element doesn't overlap
 * or stack on top of an existing one.  Scans up to 20 iterations to find
 * an open slot by shifting right by `STANDARD_BPMN_GAP`.
 */
export function avoidCollision(
  elementRegistry: any,
  x: number,
  y: number,
  elementWidth: number,
  elementHeight: number
): { x: number; y: number } {
  const allElements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type?.includes('SequenceFlow') &&
      !el.type?.includes('MessageFlow') &&
      !el.type?.includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.type !== 'bpmn:Process'
  );

  let cx = x;
  const halfW = elementWidth / 2;
  const halfH = elementHeight / 2;

  for (let attempt = 0; attempt < 20; attempt++) {
    const overlaps = allElements.some((el: any) => {
      const elLeft = el.x ?? 0;
      const elTop = el.y ?? 0;
      const elRight = elLeft + (el.width ?? 0);
      const elBottom = elTop + (el.height ?? 0);

      // New element bounding box (bpmn-js uses center-based coords)
      const newLeft = cx - halfW;
      const newTop = y - halfH;
      const newRight = cx + halfW;
      const newBottom = y + halfH;

      return newLeft < elRight && newRight > elLeft && newTop < elBottom && newBottom > elTop;
    });

    if (!overlaps) break;
    cx += elementWidth + STANDARD_BPMN_GAP;
  }

  return { x: cx, y };
}

/**
 * Create and place an element shape in the diagram. Handles boundary events,
 * participants, and regular elements (with optional participant scoping).
 */
export function createAndPlaceElement(opts: {
  diagram: any;
  elementType: string;
  descriptiveId: string;
  businessObject: any;
  x: number;
  y: number;
  hostElementId?: string;
  participantId?: string;
  parentId?: string;
  isExpanded?: boolean;
}): { createdElement: any; hostInfo?: HostInfo } {
  const {
    diagram,
    elementType,
    descriptiveId,
    businessObject,
    x,
    y,
    hostElementId,
    participantId,
    parentId,
    isExpanded,
  } = opts;
  const modeling = getService(diagram.modeler, 'modeling');
  const elementFactory = getService(diagram.modeler, 'elementFactory');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  // For SubProcess elements, pass isExpanded to createShape so that
  // bpmn-js's SubProcessPlaneBehavior correctly handles planes:
  //   - isExpanded: true  → large inline shape (350×200), no separate plane
  //   - isExpanded: false → collapsed shape (100×80), separate BPMNPlane for drilldown
  const shapeAttrs: Record<string, any> = {
    type: elementType,
    id: descriptiveId,
    businessObject,
  };
  if (elementType === 'bpmn:SubProcess' && isExpanded !== undefined) {
    shapeAttrs.isExpanded = isExpanded;
  }

  const shape = elementFactory.createShape(shapeAttrs);

  if (elementType === 'bpmn:BoundaryEvent' && hostElementId) {
    const host = requireElement(elementRegistry, hostElementId);
    const createdElement = modeling.createShape(shape, { x, y }, host, { attach: true });
    return {
      createdElement,
      hostInfo: {
        hostElementId: host.id,
        hostElementType: host.type || host.businessObject?.$type || '',
        hostElementName: host.businessObject?.name || undefined,
      },
    };
  }

  if (elementType === 'bpmn:BoundaryEvent') {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'BoundaryEvent requires hostElementId to specify the element to attach to'
    );
  }

  if (elementType === BPMN_PARTICIPANT_TYPE) {
    const canvas = getService(diagram.modeler, 'canvas');
    return { createdElement: modeling.createShape(shape, { x, y }, canvas.getRootElement()) };
  }

  // Regular element
  let parent: any;
  if (parentId) {
    // Explicit parent (SubProcess or Participant)
    parent = elementRegistry.get(parentId);
    if (!parent) {
      throw new McpError(ErrorCode.InvalidRequest, `Parent element not found: ${parentId}`);
    }
  } else if (participantId) {
    parent = elementRegistry.get(participantId);
    if (!parent) {
      throw new McpError(ErrorCode.InvalidRequest, `Participant not found: ${participantId}`);
    }
  } else {
    parent = elementRegistry.filter(
      (el: any) => el.type === 'bpmn:Process' || el.type === BPMN_PARTICIPANT_TYPE
    )[0];
  }
  if (!parent) throw new McpError(ErrorCode.InternalError, 'No bpmn:Process found in diagram');
  return { createdElement: modeling.createShape(shape, { x, y }, parent) };
}

// ── Downstream BFS collection ───────────────────────────────────────────────

/**
 * Return true if the element is a shape that should be shifted (not a connection/pool/lane).
 */
function isShiftableShape(el: any): boolean {
  if (!el.type) return false;
  return (
    !el.type.includes('SequenceFlow') &&
    !el.type.includes('MessageFlow') &&
    !el.type.includes('Association') &&
    el.type !== 'bpmn:Participant' &&
    el.type !== 'bpmn:Lane' &&
    el.type !== 'bpmn:Process' &&
    el.type !== 'bpmn:Collaboration' &&
    el.type !== 'label'
  );
}

/** Check if an element is a shiftable shape and add it (plus its boundary events) to `result`. */
function addShapeIfEligible(el: any, result: any[], visited: Set<string>): void {
  if (!isShiftableShape(el)) return;
  result.push(el);
  if (el.attachers) {
    for (const attacher of el.attachers) {
      if (!visited.has(attacher.id)) {
        result.push(attacher);
        visited.add(attacher.id);
      }
    }
  }
}

/** Follow outgoing SequenceFlow / MessageFlow targets and add unseen ones to the queue. */
function enqueueOutgoingTargets(el: any, queue: any[], visited: Set<string>): void {
  if (!el.outgoing) return;
  for (const flow of el.outgoing) {
    if (!flow.type) continue;
    if (!flow.type.includes('SequenceFlow') && !flow.type.includes('MessageFlow')) continue;
    const target = flow.target;
    if (target && !visited.has(target.id)) {
      queue.push(target);
    }
  }
}

/**
 * BFS traversal of the sequence flow graph starting from `rootElement`.
 *
 * Returns the set of shape elements reachable by following outgoing sequence
 * flows from `rootElement`, excluding the `excludeId` element (the source/anchor
 * element that we don't want to move).  Boundary events attached to reachable
 * hosts are also included.
 *
 * Used by both insert-element (C1-1) and add-element afterElementId shifting (C2-2)
 * to avoid displacing elements on unrelated parallel branches.
 */
export function collectDownstreamElements(
  elementRegistry: any,
  rootElement: any,
  excludeId: string
): any[] {
  const visited = new Set<string>();
  const queue: any[] = [rootElement];
  const result: any[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);

    if (current.id !== excludeId) {
      addShapeIfEligible(current, result, visited);
    }

    enqueueOutgoingTargets(current, queue, visited);
  }

  return result;
}
