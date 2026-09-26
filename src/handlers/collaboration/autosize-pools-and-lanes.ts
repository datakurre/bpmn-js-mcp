/**
 * Handler for autosize_bpmn_pools_and_lanes tool.
 *
 * Dynamically resizes pools and their lanes to fit contained elements
 * with proper spacing.
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
  MIN_LANE_HEIGHT,
  MIN_POOL_HEIGHT,
  MIN_POOL_ASPECT_RATIO,
  MAX_POOL_ASPECT_RATIO,
} from '../../constants';

export interface AutosizePoolsAndLanesArgs {
  diagramId: string;
  participantId?: string;
  padding?: number;
  resizeLanes?: boolean;
  targetAspectRatio?: number;
}

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
interface LaneResize {
  laneId: string;
  laneName: string;
  elementCount: number;
  oldHeight: number;
  newHeight: number;
}
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
    const x = el.x ?? 0,
      y = el.y ?? 0;
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
function shapeChanged(s: any, b: PoolBounds): boolean {
  return s.x !== b.x || s.y !== b.y || s.width !== b.width || s.height !== b.height;
}
function getLanes(reg: any, poolId: string): any[] {
  return reg
    .filter((el: any) => el.type === 'bpmn:Lane' && el.parent?.id === poolId)
    .sort((a: any, b: any) => a.y - b.y);
}

function computePoolBounds(pool: any, bbox: BBox, pad: number, ar?: number): PoolBounds {
  const padL = pad + POOL_HEADER_PADDING;
  const x = Math.min(pool.x, bbox.minX - padL);
  const y = Math.min(pool.y, bbox.minY - pad);
  let width = Math.max(MIN_POOL_WIDTH, bbox.maxX - x + pad);
  let height = Math.max(MIN_POOL_HEIGHT, bbox.maxY - y + pad);
  if (ar != null) {
    const r = Math.max(MIN_POOL_ASPECT_RATIO, Math.min(MAX_POOL_ASPECT_RATIO, ar));
    if (width / height < r) {
      width = Math.ceil(height * r);
    } else if (width / height > r) {
      height = Math.ceil(width / r);
    }
  }
  return { x, y, width, height };
}

function resizeLanesInPool(
  reg: any,
  m: any,
  poolId: string,
  pb: PoolBounds,
  pad: number
): LaneResize[] {
  const lanes = getLanes(reg, poolId);
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
    const h =
      i === lanes.length - 1
        ? pb.y + pb.height - cy
        : Math.max(MIN_LANE_HEIGHT, Math.round(heights[i] * scale));
    const tgt = {
      x: pb.x + POOL_HEADER_PADDING,
      y: cy,
      width: pb.width - POOL_HEADER_PADDING,
      height: h,
    };
    if (shapeChanged(lane, tgt)) {
      m.resizeShape(lane, tgt);
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

/**
 * Re-centre flow elements vertically inside each lane of a pool.
 * Centres the bounding box of the lane's elements (not a single row), so
 * lanes with several rows of elements keep all rows inside the lane.
 */
function centerElementsInLanes(reg: any, m: any, poolId: string): void {
  for (const lane of getLanes(reg, poolId)) {
    const elements = getLaneElements(lane, reg);
    const bb = computeBBox(elements);
    if (!bb) continue;
    const laneCY = lane.y + lane.height / 2;
    const dy = Math.round(laneCY - (bb.minY + bb.maxY) / 2);
    if (Math.abs(dy) > 2) m.moveElements(elements, { x: 0, y: dy });
  }
}

function processPool(
  pool: any,
  reg: any,
  m: any,
  pad: number,
  doLanes: boolean,
  ar?: number
): PoolResult {
  const name = pool.businessObject?.name || pool.id;

  // F5: Skip autosize entirely for column-mode pools.
  // repositionLanesAsColumns already set the correct pool width and lane
  // column positions via direct DI mutation (bypassing the command stack).
  // Calling m.resizeShape(pool, nb) here would trigger bpmn-js's ResizeLanes
  // behavior which redistributes all lanes back to equal-width horizontal rows,
  // destroying the column layout.  Since repositionLanesAsColumns already
  // computed and applied the correct pool dimensions, we can safely skip autosize.
  if ((pool as any)._columnLanes) {
    const children = getChildFlowNodes(reg, pool.id);
    return {
      participantId: pool.id,
      participantName: name,
      elementCount: children.length,
      oldWidth: pool.width,
      oldHeight: pool.height,
      newWidth: pool.width,
      newHeight: pool.height,
      resized: false,
      laneResizes: [],
    };
  }

  const children = getChildFlowNodes(reg, pool.id);
  const bbox = computeBBox(children);
  const empty: PoolResult = {
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
  if (!bbox) return empty;

  // Ensure pool height respects current lane heights set by repositionLanes()
  const lanes = getLanes(reg, pool.id);
  const minH =
    lanes.length > 0
      ? lanes.reduce((s: number, l: any) => s + Math.max(MIN_LANE_HEIGHT, l.height || 0), 0)
      : MIN_POOL_HEIGHT;
  const nb = computePoolBounds(pool, bbox, pad, ar);
  if (lanes.length > 0 && nb.height < minH) nb.height = minH;

  const changed = shapeChanged(pool, nb);
  if (changed) m.resizeShape(pool, nb);
  const lr = doLanes && changed ? resizeLanesInPool(reg, m, pool.id, nb, pad) : [];
  if (lr.length > 0) centerElementsInLanes(reg, m, pool.id);

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
      message: 'No pools found — nothing to resize.',
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
        ? [{ tool: 'layout_bpmn_diagram', description: 'Re-layout after pool/lane resizing' }]
        : [],
  });
  return appendLintFeedback(result, diagram);
}

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
        description: 'Optional. The ID of a single pool to resize. When omitted, all are resized.',
      },
      padding: {
        type: 'number',
        description: 'Minimum margin (px) around elements inside pools/lanes (default: 50).',
      },
      resizeLanes: {
        type: 'boolean',
        description: 'When true (default), also resizes lanes proportionally based on content.',
      },
      targetAspectRatio: {
        type: 'number',
        description: 'Target width:height ratio for pools (e.g. 4 means 4:1). Clamped to [3, 5].',
      },
    },
    required: ['diagramId'],
  },
} as const;
