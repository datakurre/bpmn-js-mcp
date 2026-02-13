/**
 * Handler for move_bpmn_element tool.
 *
 * Merged tool for element geometry: move, resize, and lane assignment.
 * When `laneId` is provided, handles lane membership and auto-centering.
 * When `width`/`height` are provided, resizes the element.
 * When `x`/`y` are provided, moves to absolute coordinates.
 * Multiple operations can be combined in a single call.
 */

import { type ToolResult, type DiagramState } from '../../types';
import type { BpmnElement, Modeling, ElementRegistry } from '../../bpmn-types';
import { illegalCombinationError, typeMismatchError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface MoveElementArgs {
  diagramId: string;
  elementId: string;
  x?: number;
  y?: number;
  /** ID of the target lane to move the element into. */
  laneId?: string;
  /** New width in pixels for resize. */
  width?: number;
  /** New height in pixels for resize. */
  height?: number;
}

/** Apply absolute move, returning the final position. */
function applyMove(
  modeling: Modeling,
  element: BpmnElement,
  x: number | undefined,
  y: number | undefined
): { x: number; y: number } {
  const targetX = x ?? element.x;
  const targetY = y ?? element.y;
  const deltaX = targetX - element.x;
  const deltaY = targetY - element.y;
  if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
    modeling.moveElements([element], { x: deltaX, y: deltaY });
  }
  return { x: targetX, y: targetY };
}

/** Apply resize, returning the final dimensions. */
function applyResize(
  modeling: Modeling,
  elementRegistry: ElementRegistry,
  elementId: string,
  element: BpmnElement,
  width: number | undefined,
  height: number | undefined
): { width: number; height: number } {
  const newWidth = width ?? element.width;
  const newHeight = height ?? element.height;
  const current = elementRegistry.get(elementId)!;
  modeling.resizeShape(current, {
    x: current.x,
    y: current.y,
    width: newWidth,
    height: newHeight,
  });
  return { width: newWidth, height: newHeight };
}

export async function handleMoveElement(args: MoveElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId } = args;
  const { x, y, laneId, width, height } = args;

  // Must provide at least one operation
  const hasMove = x !== undefined || y !== undefined;
  const hasResize = width !== undefined || height !== undefined;
  const hasLane = laneId !== undefined;

  if (!hasMove && !hasResize && !hasLane) {
    throw illegalCombinationError('At least one of x/y, width/height, or laneId must be provided', [
      'x',
      'y',
      'width',
      'height',
      'laneId',
    ]);
  }

  // Lane mode — handles its own flow
  if (hasLane && !hasMove && !hasResize) {
    return handleMoveToLane(diagramId, elementId, laneId!);
  }

  const diagram = requireDiagram(diagramId);
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const element = requireElement(elementRegistry, elementId);

  const actions: string[] = [];

  // Move to lane first if combined
  if (hasLane) {
    await performMoveToLane(diagram, element, laneId!);
    actions.push(`moved into lane ${laneId}`);
  }

  // Move to absolute coordinates
  if (hasMove) {
    const pos = applyMove(modeling, element, x, y);
    actions.push(`moved to (${pos.x}, ${pos.y})`);
  }

  // Resize
  if (hasResize) {
    const size = applyResize(modeling, elementRegistry, elementId, element, width, height);
    actions.push(`resized to ${size.width}×${size.height}`);
  }

  await syncXml(diagram);

  const data: Record<string, unknown> = {
    success: true,
    elementId,
    message: `Element ${elementId}: ${actions.join(', ')}`,
    nextSteps: [
      {
        tool: 'layout_bpmn_diagram',
        description: 'Re-layout the diagram to adjust connections after the move.',
      },
    ],
  };
  if (hasMove) data.position = { x: x ?? element.x, y: y ?? element.y };
  if (hasResize) data.newSize = { width: width ?? element.width, height: height ?? element.height };
  if (hasLane) data.laneId = laneId;

  const result = jsonResult(data);
  return appendLintFeedback(result, diagram);
}

/**
 * Internal helper: move an element into a lane (modifies element position).
 */
async function performMoveToLane(
  diagram: DiagramState,
  element: BpmnElement,
  laneId: string
): Promise<void> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const lane = requireElement(elementRegistry, laneId);

  if (lane.type !== 'bpmn:Lane') {
    throw typeMismatchError(laneId, lane.type, ['bpmn:Lane']);
  }

  const laneCy = lane.y + (lane.height || 0) / 2;
  const elCy = element.y + (element.height || 0) / 2;
  const laneTop = lane.y;
  const laneBottom = lane.y + (lane.height || 0);
  const halfH = (element.height || 0) / 2;

  let targetY = elCy;
  if (elCy - halfH < laneTop || elCy + halfH > laneBottom) {
    targetY = laneCy;
  }

  const dy = targetY - elCy;
  if (Math.abs(dy) > 0.5) {
    modeling.moveElements([element], { x: 0, y: dy });
  }

  const laneBo = lane.businessObject;
  if (laneBo) {
    const flowNodeRefs = laneBo.flowNodeRef || (laneBo.flowNodeRef = []);
    const elemBo = element.businessObject;
    if (elemBo && !flowNodeRefs.includes(elemBo)) {
      flowNodeRefs.push(elemBo);
    }
  }
}

const NON_LANE_MOVABLE = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:Process',
  'bpmn:Collaboration',
]);

/** Compute the Y position to place an element within a lane. */
function computeLaneTargetY(element: BpmnElement, lane: BpmnElement): number {
  const laneCy = lane.y + (lane.height || 0) / 2;
  const elCy = element.y + (element.height || 0) / 2;
  const laneTop = lane.y;
  const laneBottom = lane.y + (lane.height || 0);
  const halfH = (element.height || 0) / 2;

  if (elCy - halfH < laneTop || elCy + halfH > laneBottom) return laneCy;
  return elCy;
}

/** Register an element's business object in the lane's flowNodeRef list. */
function registerInLane(element: BpmnElement, lane: BpmnElement): void {
  const laneBo = lane.businessObject;
  if (!laneBo) return;
  const refs = (laneBo.flowNodeRef as unknown[] | undefined) || [];
  if (!laneBo.flowNodeRef) laneBo.flowNodeRef = refs;
  const elemBo = element.businessObject;
  if (elemBo && !refs.includes(elemBo)) refs.push(elemBo);
}

/**
 * Move an element into a lane (former move_to_bpmn_lane).
 */
async function handleMoveToLane(
  diagramId: string,
  elementId: string,
  laneId: string
): Promise<ToolResult> {
  const diagram = requireDiagram(diagramId);
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const element = requireElement(elementRegistry, elementId);
  const lane = requireElement(elementRegistry, laneId);

  if (lane.type !== 'bpmn:Lane') {
    throw typeMismatchError(laneId, lane.type, ['bpmn:Lane']);
  }

  const elType = element.type || '';
  if (NON_LANE_MOVABLE.has(elType)) {
    throw typeMismatchError(elementId, elType, [
      'bpmn:Task',
      'bpmn:UserTask',
      'bpmn:ServiceTask',
      'bpmn:StartEvent',
      'bpmn:EndEvent',
      'bpmn:ExclusiveGateway',
    ]);
  }

  const elCy = element.y + (element.height || 0) / 2;
  const targetY = computeLaneTargetY(element, lane);
  const dy = targetY - elCy;

  if (Math.abs(dy) > 0.5) {
    modeling.moveElements([element], { x: 0, y: dy });
  }

  registerInLane(element, lane);
  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    laneId,
    message: `Moved ${elementId} into lane ${lane.businessObject?.name || laneId}`,
  });
  return appendLintFeedback(result, diagram);
}

// Backward-compatible alias
export { handleMoveElement as handleMoveToLane };

export const TOOL_DEFINITION = {
  name: 'move_bpmn_element',
  description:
    'Move, resize, or reassign an element to a lane. Supports any combination: ' +
    'x/y to move to absolute coordinates, width/height to resize (top-left preserved), ' +
    'laneId to move into a lane with auto-centering. At least one operation must be specified.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to move or resize',
      },
      x: {
        type: 'number',
        description: 'New X coordinate (absolute position). Required unless laneId is provided.',
      },
      y: {
        type: 'number',
        description: 'New Y coordinate (absolute position). Required unless laneId is provided.',
      },
      width: {
        type: 'number',
        description: 'New width in pixels. The top-left corner position is preserved.',
      },
      height: {
        type: 'number',
        description: 'New height in pixels. The top-left corner position is preserved.',
      },
      laneId: {
        type: 'string',
        description:
          'ID of the target lane to move the element into. When provided, x/y are ignored and the element is auto-centered in the lane.',
      },
    },
    required: ['diagramId', 'elementId'],
  },
} as const;
