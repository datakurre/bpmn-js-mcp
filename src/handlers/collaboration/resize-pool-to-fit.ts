/**
 * Handler for resize_bpmn_pool_to_fit tool.
 *
 * Analyzes element positions inside a participant pool and resizes the pool
 * (and optionally its lanes) to fit all elements with proper margins.
 * Solves the common problem of elements overflowing pool boundaries.
 */
// @mutating

import { type ToolResult } from '../../types';
import { typeMismatchError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface ResizePoolToFitArgs {
  diagramId: string;
  /** The participant (pool) to resize. */
  participantId: string;
  /**
   * Padding around elements (pixels).
   * Default: 50. The pool header (left side) always gets extra padding.
   */
  padding?: number;
  /**
   * When true (default), also resizes lanes proportionally to fit
   * their contained elements.
   */
  resizeLanes?: boolean;
}

/** Default padding around elements inside the pool. */
const DEFAULT_PADDING = 50;
/** Extra padding on the left for the pool header. */
const POOL_HEADER_PADDING = 30;

/** BPMN types that are connection-like (not sizeable flow nodes). */
const CONNECTION_TYPES = new Set([
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Association',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
]);

/** Types that are structural / non-flow. */
const STRUCTURAL_TYPES = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:LaneSet',
  'bpmn:Process',
  'bpmn:Collaboration',
  'label',
]);

/** Check if an element is a flow node. */
function isFlowNode(type: string): boolean {
  return !CONNECTION_TYPES.has(type) && !STRUCTURAL_TYPES.has(type);
}

/** Get flow nodes inside a participant. */
function getChildFlowNodes(elementRegistry: any, participantId: string): any[] {
  return elementRegistry.filter(
    (el: any) =>
      el.parent?.id === participantId && isFlowNode(el.type) && !el.type?.includes('Connection')
  );
}

/** Compute bounding box of a set of elements. */
function computeBoundingBox(elements: any[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (elements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }

  return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Get all lanes inside a participant. */
function getLanes(elementRegistry: any, participantId: string): any[] {
  return elementRegistry.filter(
    (el: any) => el.type === 'bpmn:Lane' && el.parent?.id === participantId
  );
}

/** Get elements assigned to a specific lane (via flowNodeRef). */
function getElementsInLane(lane: any, elementRegistry: any): any[] {
  const refs = lane.businessObject?.flowNodeRef || [];
  return refs
    .map((ref: any) => {
      const id = typeof ref === 'string' ? ref : ref.id;
      return elementRegistry.get(id);
    })
    .filter(Boolean);
}

/** Compute new bounds for pool to fit its children with padding. */
function computePoolBounds(
  pool: any,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  padding: number
): { x: number; y: number; width: number; height: number } {
  const padLeft = padding + POOL_HEADER_PADDING;
  const newX = Math.min(pool.x, bbox.minX - padLeft);
  const newY = Math.min(pool.y, bbox.minY - padding);
  return {
    x: newX,
    y: newY,
    width: Math.max(pool.width || 600, bbox.maxX - newX + padding),
    height: Math.max(pool.height || 250, bbox.maxY - newY + padding),
  };
}

/** Resize lanes inside a pool to distribute height based on content. */
function resizeLanesInPool(
  elementRegistry: any,
  modeling: any,
  participantId: string,
  newBounds: { x: number; y: number; width: number; height: number },
  padding: number
): Array<{ laneId: string; laneName: string; oldHeight: number; newHeight: number }> {
  const lanes = getLanes(elementRegistry, participantId);
  if (lanes.length === 0) return [];

  const sortedLanes = [...lanes].sort((a: any, b: any) => a.y - b.y);
  const evenHeight = Math.floor(newBounds.height / sortedLanes.length);
  const resizes: Array<{ laneId: string; laneName: string; oldHeight: number; newHeight: number }> =
    [];

  let currentY = newBounds.y;
  for (let i = 0; i < sortedLanes.length; i++) {
    const lane = sortedLanes[i];
    const laneElements = getElementsInLane(lane, elementRegistry);
    const laneBbox = computeBoundingBox(laneElements);

    let laneHeight: number;
    if (i === sortedLanes.length - 1) {
      laneHeight = newBounds.y + newBounds.height - currentY;
    } else if (laneBbox) {
      const contentHeight = laneBbox.maxY - laneBbox.minY + padding * 2;
      laneHeight = Math.max(evenHeight, contentHeight);
    } else {
      laneHeight = evenHeight;
    }
    laneHeight = Math.max(laneHeight, 80);

    const targetBounds = {
      x: newBounds.x + POOL_HEADER_PADDING,
      y: currentY,
      width: newBounds.width - POOL_HEADER_PADDING,
      height: laneHeight,
    };
    const oldHeight = lane.height;
    const boundsChanged =
      lane.x !== targetBounds.x ||
      lane.y !== targetBounds.y ||
      lane.width !== targetBounds.width ||
      lane.height !== targetBounds.height;

    if (boundsChanged) {
      modeling.resizeShape(lane, targetBounds);
      resizes.push({
        laneId: lane.id,
        laneName: lane.businessObject?.name || lane.id,
        oldHeight,
        newHeight: laneHeight,
      });
    }
    currentY += laneHeight;
  }
  return resizes;
}

/** Check if two bounds objects differ. */
function boundsChanged(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;
}

export async function handleResizePoolToFit(args: ResizePoolToFitArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'participantId']);
  const { diagramId, participantId, padding = DEFAULT_PADDING, resizeLanes = true } = args;

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');

  const participant = requireElement(elementRegistry, participantId);
  if (participant.type !== 'bpmn:Participant') {
    throw typeMismatchError(participantId, participant.type, ['bpmn:Participant']);
  }

  const children = getChildFlowNodes(elementRegistry, participantId);
  const bbox = computeBoundingBox(children);

  if (!bbox) {
    return jsonResult({
      success: true,
      participantId,
      message: 'Pool has no flow elements — no resize needed.',
      resized: false,
    });
  }

  const oldBounds = {
    x: participant.x,
    y: participant.y,
    width: participant.width,
    height: participant.height,
  };

  const newBounds = computePoolBounds(participant, bbox, padding);
  const changed = boundsChanged(oldBounds, newBounds);

  if (changed) {
    modeling.resizeShape(participant, newBounds);
  }

  const laneResizes =
    resizeLanes && changed
      ? resizeLanesInPool(elementRegistry, modeling, participantId, newBounds, padding)
      : [];

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    participantId,
    participantName: participant.businessObject?.name || participantId,
    resized: changed,
    elementCount: children.length,
    oldBounds,
    newBounds: changed ? newBounds : oldBounds,
    ...(laneResizes.length > 0 ? { laneResizes } : {}),
    message: changed
      ? `Resized pool "${participant.businessObject?.name || participantId}" ` +
        `from ${oldBounds.width}×${oldBounds.height} to ${newBounds.width}×${newBounds.height} ` +
        `to fit ${children.length} elements.` +
        (laneResizes.length > 0 ? ` Resized ${laneResizes.length} lane(s).` : '')
      : `Pool "${participant.businessObject?.name || participantId}" already fits all ${children.length} elements.`,
  });
  return appendLintFeedback(result, diagram);
}

// ── Tool definition (deprecated — subsumed by autosize_bpmn_pools_and_lanes) ──

/** @deprecated Not registered as an MCP tool. */
const _UNUSED_TOOL_DEFINITION = {
  name: 'resize_bpmn_pool_to_fit',
  description:
    'Resize a participant pool (and optionally its lanes) to fit all contained elements ' +
    'with proper margins. Solves the common problem of elements overflowing pool boundaries. ' +
    'Calculates the bounding box of all flow elements inside the pool and expands the pool ' +
    'to accommodate them with configurable padding. The pool header (left side) always gets ' +
    'extra padding automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
      participantId: {
        type: 'string',
        description: 'The ID of the participant (pool) to resize',
      },
      padding: {
        type: 'number',
        description:
          'Padding in pixels around elements (default: 50). ' +
          'The pool header side gets additional 30px automatically.',
      },
      resizeLanes: {
        type: 'boolean',
        description:
          'When true (default), also resizes lanes to fit their contained elements. ' +
          'Lanes are distributed based on their content height.',
      },
    },
    required: ['diagramId', 'participantId'],
  },
} as const;
