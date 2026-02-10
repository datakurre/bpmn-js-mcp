/**
 * Positioning helpers for add-element: shift downstream elements,
 * resize containers, lane detection and snapping.
 *
 * Split from add-element.ts for file-size compliance.
 */

import { getVisibleElements, requireElement } from './helpers';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

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
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.id !== excludeId
  );
  const toShift = allElements.filter((el: any) => el.x >= fromX);
  for (const el of toShift) {
    modeling.moveElements([el], { x: shiftAmount, y: 0 });
  }

  resizeParentContainers(elementRegistry, modeling);
}

/**
 * Resize participant pools and lanes that are too narrow after elements
 * were shifted right.
 */
export function resizeParentContainers(elementRegistry: any, modeling: any): void {
  const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
  for (const pool of participants) {
    const children = elementRegistry.filter(
      (el: any) =>
        el.parent === pool &&
        el.type !== 'bpmn:Lane' &&
        !el.type.includes('SequenceFlow') &&
        !el.type.includes('MessageFlow') &&
        !el.type.includes('Association')
    );
    if (children.length === 0) continue;

    let maxRight = 0;
    for (const child of children) {
      const right = child.x + (child.width || 0);
      if (right > maxRight) maxRight = right;
    }

    const poolRight = pool.x + (pool.width || 0);
    const padding = 50;
    if (maxRight + padding > poolRight) {
      const newWidth = maxRight - pool.x + padding;
      modeling.resizeShape(pool, {
        x: pool.x,
        y: pool.y,
        width: newWidth,
        height: pool.height || 250,
      });
    }
  }

  const lanes = elementRegistry.filter((el: any) => el.type === 'bpmn:Lane');
  for (const lane of lanes) {
    const parent = lane.parent;
    if (parent && parent.type === 'bpmn:Participant') {
      const poolWidth = parent.width || 600;
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
}

/**
 * Find the lane that contains a given (x, y) coordinate.
 */
function findContainingLane(elementRegistry: any, x: number, y: number): any {
  const lanes = elementRegistry.filter((el: any) => el.type === 'bpmn:Lane');
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
  } = opts;
  const modeling = diagram.modeler.get('modeling');
  const elementFactory = diagram.modeler.get('elementFactory');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  const shape = elementFactory.createShape({
    type: elementType,
    id: descriptiveId,
    businessObject,
  });

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

  if (elementType === 'bpmn:Participant') {
    const canvas = diagram.modeler.get('canvas');
    return { createdElement: modeling.createShape(shape, { x, y }, canvas.getRootElement()) };
  }

  // Regular element
  let parent: any;
  if (participantId) {
    parent = elementRegistry.get(participantId);
    if (!parent) {
      throw new McpError(ErrorCode.InvalidRequest, `Participant not found: ${participantId}`);
    }
  } else {
    parent = elementRegistry.filter(
      (el: any) => el.type === 'bpmn:Process' || el.type === 'bpmn:Participant'
    )[0];
  }
  if (!parent) throw new McpError(ErrorCode.InternalError, 'No bpmn:Process found in diagram');
  return { createdElement: modeling.createShape(shape, { x, y }, parent) };
}
