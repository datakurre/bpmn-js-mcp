/**
 * Handler for autosize_bpmn_pools_and_lanes tool.
 *
 * Dynamically resizes pools and their lanes in a diagram to fit
 * contained elements with proper spacing. When participantId is given,
 * only that single pool is resized; otherwise all pools are processed.
 */
// @mutating

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  getService,
} from '../helpers';
import { typeMismatchError } from '../../errors';
import { appendLintFeedback } from '../../linter';
import {
  MIN_POOL_WIDTH,
  WIDTH_PER_ELEMENT,
  MIN_LANE_HEIGHT,
  MIN_POOL_ASPECT_RATIO,
  MAX_POOL_ASPECT_RATIO,
} from '../../constants';

export interface AutosizePoolsAndLanesArgs {
  diagramId: string;
  /** When set, only resize this single participant (pool). When omitted, resize all pools. */
  participantId?: string;
  /** Minimum margin around elements inside pools/lanes (pixels). Default: 50. */
  padding?: number;
  /** When true (default), also resizes lanes proportionally based on content. */
  resizeLanes?: boolean;
  /**
   * Target width:height aspect ratio for pools (e.g. 4 means 4:1).
   * When set, pool dimensions are adjusted to approach this ratio while
   * still fitting all elements. Clamped to [3, 5] range for readability.
   */
  targetAspectRatio?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_PADDING = 50;
const POOL_HEADER_PADDING = 30;

const CONNECTION_TYPES = new Set([
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Association',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
]);

const STRUCTURAL_TYPES = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:LaneSet',
  'bpmn:Process',
  'bpmn:Collaboration',
  'label',
]);

// ── Geometry helpers ───────────────────────────────────────────────────────

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PoolBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isFlowNode(type: string): boolean {
  return !CONNECTION_TYPES.has(type) && !STRUCTURAL_TYPES.has(type);
}

function getChildFlowNodes(reg: any, pid: string): any[] {
  return reg.filter(
    (el: any) => el.parent?.id === pid && isFlowNode(el.type) && !el.type?.includes('Connection')
  );
}

function computeBBox(elements: any[]): BBox | null {
  if (elements.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const el of elements) {
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + (el.width ?? 0) > maxX) maxX = x + (el.width ?? 0);
    if (y + (el.height ?? 0) > maxY) maxY = y + (el.height ?? 0);
  }
  return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function getLaneElements(lane: any, reg: any): any[] {
  return (lane.businessObject?.flowNodeRef || [])
    .map((ref: any) => reg.get(typeof ref === 'string' ? ref : ref.id))
    .filter(Boolean);
}

function shapeChanged(shape: any, b: PoolBounds): boolean {
  return shape.x !== b.x || shape.y !== b.y || shape.width !== b.width || shape.height !== b.height;
}

// ── Pool bounds calculation ────────────────────────────────────────────────

function computePoolBounds(
  pool: any,
  bbox: BBox,
  pad: number,
  count: number,
  targetAspectRatio?: number
): PoolBounds {
  const contentW = bbox.maxX - bbox.minX;
  const estW = Math.max(
    MIN_POOL_WIDTH,
    contentW + pad * 2 + POOL_HEADER_PADDING,
    count * WIDTH_PER_ELEMENT
  );
  const padL = pad + POOL_HEADER_PADDING;
  const x = Math.min(pool.x, bbox.minX - padL);
  const y = Math.min(pool.y, bbox.minY - pad);
  let width = Math.max(pool.width || MIN_POOL_WIDTH, estW, bbox.maxX - x + pad);
  let height = Math.max(pool.height || 250, bbox.maxY - y + pad);

  // Enforce aspect ratio when requested
  if (targetAspectRatio != null) {
    const ratio = Math.max(
      MIN_POOL_ASPECT_RATIO,
      Math.min(MAX_POOL_ASPECT_RATIO, targetAspectRatio)
    );
    const currentRatio = width / height;
    if (currentRatio < ratio) {
      // Too tall/narrow — increase width
      width = Math.ceil(height * ratio);
    } else if (currentRatio > ratio) {
      // Too wide/short — increase height
      height = Math.ceil(width / ratio);
    }
  }

  return { x, y, width, height };
}

// ── Lane resizing ──────────────────────────────────────────────────────────

interface LaneResize {
  laneId: string;
  laneName: string;
  elementCount: number;
  oldHeight: number;
  newHeight: number;
}

function resizeLanesInPool(
  reg: any,
  modeling: any,
  poolId: string,
  pb: PoolBounds,
  pad: number
): LaneResize[] {
  const lanes = reg
    .filter((el: any) => el.type === 'bpmn:Lane' && el.parent?.id === poolId)
    .sort((a: any, b: any) => a.y - b.y);
  if (lanes.length === 0) return [];

  const heights = lanes.map((l: any) => {
    const bb = computeBBox(getLaneElements(l, reg));
    return bb ? Math.max(MIN_LANE_HEIGHT, bb.maxY - bb.minY + pad * 2) : MIN_LANE_HEIGHT;
  });
  const total = heights.reduce((a: number, b: number) => a + b, 0);
  const scale = total > 0 ? pb.height / total : 1;
  const resizes: LaneResize[] = [];
  let cy = pb.y;

  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const isLast = i === lanes.length - 1;
    const h = isLast
      ? pb.y + pb.height - cy
      : Math.max(MIN_LANE_HEIGHT, Math.round(heights[i] * scale));
    const target = {
      x: pb.x + POOL_HEADER_PADDING,
      y: cy,
      width: pb.width - POOL_HEADER_PADDING,
      height: h,
    };

    if (shapeChanged(lane, target)) {
      modeling.resizeShape(lane, target);
      resizes.push({
        laneId: lane.id,
        laneName: lane.businessObject?.name || lane.id,
        elementCount: getLaneElements(lane, reg).length,
        oldHeight: lane.height,
        newHeight: h,
      });
    }
    cy += h;
  }
  return resizes;
}

// ── Single-pool processing ─────────────────────────────────────────────────

interface PoolResult {
  participantId: string;
  participantName: string;
  elementCount: number;
  oldWidth: number;
  oldHeight: number;
  newWidth: number;
  newHeight: number;
  resized: boolean;
  laneResizes: LaneResize[];
}

function processPool(
  pool: any,
  reg: any,
  modeling: any,
  pad: number,
  doLanes: boolean,
  targetAspectRatio?: number
): PoolResult {
  const name = pool.businessObject?.name || pool.id;
  const children = getChildFlowNodes(reg, pool.id);
  const bbox = computeBBox(children);

  if (!bbox) {
    return {
      participantId: pool.id,
      participantName: name,
      elementCount: 0,
      oldWidth: pool.width,
      oldHeight: pool.height,
      newWidth: pool.width,
      newHeight: pool.height,
      resized: false,
      laneResizes: [],
    };
  }

  const nb = computePoolBounds(pool, bbox, pad, children.length, targetAspectRatio);
  const changed = shapeChanged(pool, nb);
  if (changed) modeling.resizeShape(pool, nb);

  const lr = doLanes && changed ? resizeLanesInPool(reg, modeling, pool.id, nb, pad) : [];
  return {
    participantId: pool.id,
    participantName: name,
    elementCount: children.length,
    oldWidth: pool.width || 0,
    oldHeight: pool.height || 0,
    newWidth: nb.width,
    newHeight: nb.height,
    resized: changed,
    laneResizes: lr,
  };
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleAutosizePoolsAndLanes(
  args: AutosizePoolsAndLanesArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const {
    diagramId,
    participantId,
    padding = DEFAULT_PADDING,
    resizeLanes: doLanes = true,
    targetAspectRatio,
  } = args;
  const diagram = requireDiagram(diagramId);
  const reg = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');

  // When participantId is specified, only resize that single pool
  if (participantId) {
    const pool = requireElement(reg, participantId);
    if (pool.type !== 'bpmn:Participant') {
      throw typeMismatchError(participantId, pool.type, ['bpmn:Participant']);
    }
    const pr = processPool(pool, reg, modeling, padding, doLanes, targetAspectRatio);
    await syncXml(diagram);

    const result = jsonResult({
      success: true,
      participantId: pr.participantId,
      participantName: pr.participantName,
      resized: pr.resized,
      elementCount: pr.elementCount,
      oldBounds: { width: pr.oldWidth, height: pr.oldHeight },
      newBounds: { width: pr.newWidth, height: pr.newHeight },
      ...(pr.laneResizes.length > 0 ? { laneResizes: pr.laneResizes } : {}),
      message: pr.resized
        ? `Resized pool "${pr.participantName}" from ${pr.oldWidth}×${pr.oldHeight} to ${pr.newWidth}×${pr.newHeight} to fit ${pr.elementCount} elements.` +
          (pr.laneResizes.length > 0 ? ` Resized ${pr.laneResizes.length} lane(s).` : '')
        : `Pool "${pr.participantName}" already fits all ${pr.elementCount} elements.`,
    });
    return appendLintFeedback(result, diagram);
  }

  const pools = reg.filter((el: any) => el.type === 'bpmn:Participant');

  if (pools.length === 0) {
    return jsonResult({
      success: true,
      message: 'No pools found in diagram — nothing to resize.',
      poolResults: [],
    });
  }

  const results = pools.map((p: any) =>
    processPool(p, reg, modeling, padding, doLanes, targetAspectRatio)
  );
  await syncXml(diagram);

  const resized = results.filter((r: PoolResult) => r.resized).length;
  const result = jsonResult({
    success: true,
    poolCount: pools.length,
    resizedCount: resized,
    poolResults: results,
    message:
      resized > 0
        ? `Resized ${resized} of ${pools.length} pool(s) to fit their elements.`
        : `All ${pools.length} pool(s) already fit their elements.`,
    nextSteps:
      resized > 0
        ? [
            {
              tool: 'layout_bpmn_diagram',
              description: 'Re-layout diagram after pool/lane resizing',
            },
          ]
        : [],
  });
  return appendLintFeedback(result, diagram);
}

// ── Tool definition ────────────────────────────────────────────────────────

export const TOOL_DEFINITION = {
  name: 'autosize_bpmn_pools_and_lanes',
  description:
    'Resize pools and their lanes to fit contained elements with proper spacing. ' +
    'When participantId is given, resizes only that single pool. When omitted, resizes all pools. ' +
    'Calculates optimal pool width based on element count and content extent. ' +
    'Lane heights are proportionally distributed based on their content.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      participantId: {
        type: 'string',
        description:
          'Optional. The ID of a single participant (pool) to resize. ' +
          'When omitted, all pools in the diagram are resized.',
      },
      padding: {
        type: 'number',
        description:
          'Minimum margin in pixels around elements inside pools/lanes (default: 50). ' +
          'Pool headers get additional 30px automatically.',
      },
      resizeLanes: {
        type: 'boolean',
        description:
          'When true (default), also resizes lanes proportionally based on their content height.',
      },
      targetAspectRatio: {
        type: 'number',
        description:
          'Target width:height aspect ratio for pools (e.g. 4 means 4:1 width to height). ' +
          'Pool dimensions are adjusted to approach this ratio while still fitting all elements. ' +
          'Clamped to [3, 5] range for readability. Omit to skip aspect ratio enforcement.',
      },
    },
    required: ['diagramId'],
  },
} as const;
