/**
 * Handler for move_bpmn_element tool.
 *
 * Merged tool for element geometry: move, resize, and lane assignment.
 * When `laneId` is provided, handles lane membership and auto-centering.
 * When `width`/`height` are provided, resizes the element.
 * When `x`/`y` are provided, moves to absolute coordinates.
 * Multiple operations can be combined in a single call.
 */
// @mutating

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
import { handleMoveElementBatch } from './move-element-batch';

export interface MoveElementArgs {
  diagramId: string;
  /** Required for the single-element form. Omit when using `moves`. */
  elementId?: string;
  x?: number;
  y?: number;
  /** ID of the target lane to move the element into. */
  laneId?: string;
  /** New width in pixels for resize. */
  width?: number;
  /** New height in pixels for resize. */
  height?: number;
  /**
   * Batch form: move/resize/relane several elements in one call, as a single
   * undo step. Alternative to the single-element `elementId` (+ x/y/laneId/
   * width/height) fields above.
   */
  moves?: MoveItem[];
}

/** One element's worth of move/resize/relane within the `moves` batch form. */
export interface MoveItem {
  elementId: string;
  x?: number;
  y?: number;
  laneId?: string;
  width?: number;
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

export interface MoveItemResult {
  elementId: string;
  actions: string[];
  hasMove: boolean;
  hasResize: boolean;
  hasLane: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  laneId?: string;
  element: BpmnElement;
}

/** Throws unless at least one of x/y, width/height, or laneId is present. */
function assertMoveItemHasOp(hasMove: boolean, hasResize: boolean, hasLane: boolean): void {
  if (!hasMove && !hasResize && !hasLane) {
    throw illegalCombinationError('At least one of x/y, width/height, or laneId must be provided', [
      'x',
      'y',
      'width',
      'height',
      'laneId',
    ]);
  }
}

/**
 * Validate and apply one element's move/resize/relane. Synchronous — no XML
 * sync, no lint — so it is safe to call from within a command-stack
 * `preExecute` alongside other elements' moves, grouped into one undo step
 * (see `ensureBatchMoveCommand` below). `performMoveToLane` is declared
 * `async` but has no real `await` inside, so calling it without awaiting
 * still runs its mutation synchronously before this function returns.
 */
export function applyMoveItemCore(
  diagram: ReturnType<typeof requireDiagram>,
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  item: MoveItem
): MoveItemResult {
  const { elementId, x, y, laneId, width, height } = item;
  const hasMove = x !== undefined || y !== undefined;
  const hasResize = width !== undefined || height !== undefined;
  const hasLane = laneId !== undefined;
  assertMoveItemHasOp(hasMove, hasResize, hasLane);

  const element = requireElement(elementRegistry, elementId);
  const actions: string[] = [];

  if (hasLane) {
    void performMoveToLane(diagram, element, laneId!);
    actions.push(`moved into lane ${laneId}`);
  }
  if (hasMove) {
    const pos = applyMove(modeling, element, x, y);
    actions.push(`moved to (${pos.x}, ${pos.y})`);
  }
  if (hasResize) {
    const size = applyResize(modeling, elementRegistry, elementId, element, width, height);
    actions.push(`resized to ${size.width}×${size.height}`);
  }

  pinElement(diagram, elementId);

  return { elementId, actions, hasMove, hasResize, hasLane, x, y, width, height, laneId, element };
}

export async function handleMoveElement(args: MoveElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);

  if (args.moves) {
    return handleMoveElementBatch(args.diagramId, args.moves);
  }

  validateArgs(args, ['elementId']);
  return handleMoveElementSingle(args);
}

async function handleMoveElementSingle(args: MoveElementArgs): Promise<ToolResult> {
  const { diagramId, x, y, laneId, width, height } = args;
  const elementId = args.elementId as string;

  const hasMove = x !== undefined || y !== undefined;
  const hasResize = width !== undefined || height !== undefined;
  const hasLane = laneId !== undefined;
  assertMoveItemHasOp(hasMove, hasResize, hasLane);

  // Lane-only mode — handles its own flow
  if (hasLane && !hasMove && !hasResize) {
    return handleMoveToLane(diagramId, elementId, laneId!);
  }

  const diagram = requireDiagram(diagramId);
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const itemResult = applyMoveItemCore(diagram, elementRegistry, modeling, {
    elementId,
    x,
    y,
    laneId,
    width,
    height,
  });

  await syncXml(diagram);

  const result = jsonResult(buildMoveResult(elementId, itemResult.actions, itemResult));
  return appendLintFeedback(result, diagram);
}

/** Mark an element as manually pinned (survives partial re-layouts). */
function pinElement(diagram: DiagramState, elementId: string): void {
  if (!diagram.pinnedElements) diagram.pinnedElements = new Set();
  diagram.pinnedElements.add(elementId);
}

/** Build the response data for a move/resize operation. */
function buildMoveResult(
  elementId: string,
  actions: string[],
  ctx: {
    hasMove: boolean;
    hasResize: boolean;
    hasLane: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    laneId?: string;
    element: BpmnElement;
  }
): Record<string, unknown> {
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
  if (ctx.hasMove) data.position = { x: ctx.x ?? ctx.element.x, y: ctx.y ?? ctx.element.y };
  if (ctx.hasResize) {
    data.newSize = {
      width: ctx.width ?? ctx.element.width,
      height: ctx.height ?? ctx.element.height,
    };
  }
  if (ctx.hasLane) data.laneId = ctx.laneId;
  return data;
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
  if (!laneBo.flowNodeRef) laneBo.flowNodeRef = [];
  const refs = laneBo.flowNodeRef;
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

/** Per-element move/resize/relane properties, shared between the single-element form and each `moves[]` item. */
const MOVE_CONCERN_SCHEMA_PROPERTIES = {
  x: { type: 'number', description: 'New X coordinate. Required unless laneId is given.' },
  y: { type: 'number', description: 'New Y coordinate. Required unless laneId is given.' },
  width: { type: 'number', description: 'New width in pixels (top-left preserved).' },
  height: { type: 'number', description: 'New height in pixels (top-left preserved).' },
  laneId: {
    type: 'string',
    description: 'Target lane ID; x/y are ignored and the element is auto-centered in the lane.',
  },
} as const;

/** Lean per-item schema for `moves[]` — same fields as above, no repeated descriptions. */
const MOVE_ITEM_CONCERN_PROPERTIES = {
  x: { type: 'number' },
  y: { type: 'number' },
  width: { type: 'number' },
  height: { type: 'number' },
  laneId: { type: 'string' },
} as const;

export const TOOL_DEFINITION = {
  name: 'move_bpmn_element',
  description:
    'Move, resize, or reassign an element to a lane. Any combination of x/y (absolute move), ' +
    'width/height (resize, top-left preserved), and laneId (auto-centered) — at least one required. ' +
    'For several elements at once, pass `moves: [{ elementId, x?, y?, width?, height?, laneId? }]` ' +
    'instead — validated up front, applied as one undo step.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'Element to move or resize. Omit when using `moves`.',
      },
      ...MOVE_CONCERN_SCHEMA_PROPERTIES,
      moves: {
        type: 'array',
        description: 'Batch form — see the tool description.',
        items: {
          type: 'object',
          properties: {
            elementId: { type: 'string', description: 'Element to move or resize' },
            ...MOVE_ITEM_CONCERN_PROPERTIES,
          },
          required: ['elementId'],
        },
      },
    },
    required: ['diagramId'],
  },
} as const;
