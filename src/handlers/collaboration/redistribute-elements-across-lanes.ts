/**
 * Handler for redistribute_bpmn_elements_across_lanes tool.
 *
 * Rebalances element placement across existing lanes when lanes become
 * overcrowded or when elements are not optimally assigned. Uses role-based
 * matching, flow-neighbor analysis, and lane capacity balancing.
 *
 * When validate=true, combines validation + redistribution into a single
 * operation (previously the separate optimize_bpmn_lane_assignments tool).
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
import { extractPrimaryRole, isFlowControl } from './auto-distribute';
import {
  findParticipantWithLanes,
  validateAndRedistribute,
  buildRedistributeResult,
} from './validate-and-redistribute';

export interface RedistributeElementsAcrossLanesArgs {
  diagramId: string;
  participantId?: string;
  strategy?: 'role-based' | 'balance' | 'minimize-crossings';
  reposition?: boolean;
  dryRun?: boolean;
  /** When true, runs validation before and after redistribution (merged optimize flow). */
  validate?: boolean;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface LaneInfo {
  id: string;
  name: string;
  element: any;
  centerY: number;
}

interface MoveRecord {
  elementId: string;
  elementName: string;
  elementType: string;
  fromLaneId: string;
  fromLaneName: string;
  toLaneId: string;
  toLaneName: string;
  reason: string;
}

const NON_ASSIGNABLE = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:LaneSet',
  'bpmn:Process',
  'bpmn:Collaboration',
]);

// ── Lane helpers ───────────────────────────────────────────────────────────

function getLanes(reg: any, poolId: string): LaneInfo[] {
  return reg
    .filter((el: any) => el.type === 'bpmn:Lane' && el.parent?.id === poolId)
    .map((l: any) => ({
      id: l.id,
      name: l.businessObject?.name || l.id,
      element: l,
      centerY: l.y + (l.height || 0) / 2,
    }));
}

function buildCurrentLaneMap(lanes: LaneInfo[]): Map<string, LaneInfo> {
  const map = new Map<string, LaneInfo>();
  for (const lane of lanes) {
    for (const ref of lane.element.businessObject?.flowNodeRef || []) {
      map.set(typeof ref === 'string' ? ref : ref.id, lane);
    }
  }
  return map;
}

function getFlowNodes(reg: any, poolId: string): any[] {
  return reg.filter(
    (el: any) =>
      el.parent?.id === poolId &&
      !NON_ASSIGNABLE.has(el.type) &&
      !el.type?.includes('Flow') &&
      !el.type?.includes('Association')
  );
}

// ── Matching helpers ───────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

function roleMatchesLane(role: string, laneName: string): boolean {
  const r = normalize(role);
  const l = normalize(laneName);
  return r === l || l.includes(r) || r.includes(l) || r + 's' === l || r === l + 's';
}

function findRoleLane(bo: any, lanes: LaneInfo[]): LaneInfo | null {
  const role = extractPrimaryRole(bo);
  if (!role) return null;
  return lanes.find((l) => roleMatchesLane(role, l.name)) || null;
}

function findNeighborLane(bo: any, map: Map<string, LaneInfo>): LaneInfo | null {
  const votes = new Map<string, { lane: LaneInfo; count: number }>();
  const neighbors = [
    ...(bo.incoming || []).map((f: any) => f.sourceRef).filter(Boolean),
    ...(bo.outgoing || []).map((f: any) => f.targetRef).filter(Boolean),
  ];
  for (const n of neighbors) {
    const lane = map.get(n.id);
    if (!lane) continue;
    const e = votes.get(lane.id) || { lane, count: 0 };
    e.count++;
    votes.set(lane.id, e);
  }
  let best: { lane: LaneInfo; count: number } | null = null;
  for (const e of votes.values()) {
    if (!best || e.count > best.count) best = e;
  }
  return best?.lane || null;
}

function findLeastPopulated(lanes: LaneInfo[]): LaneInfo {
  const counts = new Map<string, number>();
  for (const l of lanes) {
    counts.set(l.id, (l.element.businessObject?.flowNodeRef || []).length);
  }
  let min = Infinity;
  let result = lanes[0];
  for (const l of lanes) {
    const c = counts.get(l.id) || 0;
    if (c < min) {
      min = c;
      result = l;
    }
  }
  return result;
}

// ── Lane mutation helpers ──────────────────────────────────────────────────

function removeFromAllLanes(lanes: LaneInfo[], bo: any): void {
  for (const lane of lanes) {
    const refs = lane.element.businessObject?.flowNodeRef;
    if (!Array.isArray(refs)) continue;
    const idx = refs.indexOf(bo);
    if (idx >= 0) refs.splice(idx, 1);
  }
}

function addToLane(lane: LaneInfo, bo: any): void {
  const laneBo = lane.element.businessObject;
  if (!laneBo) return;
  const refs: unknown[] = (laneBo.flowNodeRef as unknown[] | undefined) || [];
  if (!laneBo.flowNodeRef) laneBo.flowNodeRef = refs;
  if (!refs.includes(bo)) refs.push(bo);
}

function repositionInLane(modeling: any, el: any, lane: LaneInfo): void {
  const dy = lane.centerY - (el.y + (el.height || 0) / 2);
  if (Math.abs(dy) > 0.5) modeling.moveElements([el], { x: 0, y: dy });
}

// ── Strategy functions ─────────────────────────────────────────────────────

function resolveTarget(
  element: any,
  bo: any,
  strategy: string,
  lanes: LaneInfo[],
  laneMap: Map<string, LaneInfo>
): { lane: LaneInfo | null; reason: string } {
  if (strategy === 'role-based') {
    if (!isFlowControl(element.type)) {
      const l = findRoleLane(bo, lanes);
      if (l) return { lane: l, reason: 'role matches lane name' };
    }
    if (isFlowControl(element.type)) {
      const l = findNeighborLane(bo, laneMap);
      if (l) return { lane: l, reason: 'majority of connected neighbors are in this lane' };
    }
    return { lane: null, reason: '' };
  }
  if (strategy === 'minimize-crossings') {
    const l = findNeighborLane(bo, laneMap);
    return l ? { lane: l, reason: 'minimizes cross-lane flows' } : { lane: null, reason: '' };
  }
  // balance
  if (!isFlowControl(element.type)) {
    const l = findRoleLane(bo, lanes);
    if (l) return { lane: l, reason: 'role matches lane name' };
  }
  return { lane: findLeastPopulated(lanes), reason: 'balancing lane element count' };
}

// ── Move collection ────────────────────────────────────────────────────────

function tryMove(
  el: any,
  strategy: string,
  lanes: LaneInfo[],
  laneMap: Map<string, LaneInfo>
): MoveRecord | null {
  const bo = el.businessObject;
  if (!bo) return null;
  const current = laneMap.get(bo.id);
  const { lane: target, reason } = resolveTarget(el, bo, strategy, lanes, laneMap);
  if (!target || (current && current.id === target.id)) return null;
  return {
    elementId: bo.id,
    elementName: bo.name || bo.id,
    elementType: el.type,
    fromLaneId: current?.id || '(none)',
    fromLaneName: current?.name || '(unassigned)',
    toLaneId: target.id,
    toLaneName: target.name,
    reason,
  };
}

function applyMove(
  move: MoveRecord,
  el: any,
  lanes: LaneInfo[],
  laneMap: Map<string, LaneInfo>,
  reposition: boolean,
  modeling: any
): void {
  const bo = el.businessObject;
  const target = lanes.find((l) => l.id === move.toLaneId)!;
  removeFromAllLanes(lanes, bo);
  addToLane(target, bo);
  laneMap.set(bo.id, target);
  if (reposition) repositionInLane(modeling, el, target);
}

function collectMoves(
  flowNodes: any[],
  strategy: string,
  lanes: LaneInfo[],
  laneMap: Map<string, LaneInfo>,
  dryRun: boolean,
  reposition: boolean,
  modeling: any
): MoveRecord[] {
  const moves: MoveRecord[] = [];
  for (const el of flowNodes) {
    const move = tryMove(el, strategy, lanes, laneMap);
    if (!move) continue;
    moves.push(move);
    if (!dryRun) {
      applyMove(move, el, lanes, laneMap, reposition, modeling);
    }
  }
  return moves;
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleRedistributeElementsAcrossLanes(
  args: RedistributeElementsAcrossLanesArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const {
    diagramId,
    strategy = 'role-based',
    reposition = true,
    dryRun = false,
    validate = false,
  } = args;

  const diagram = requireDiagram(diagramId);
  const reg = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');

  // Auto-detect participantId when omitted
  const participantId = args.participantId || findParticipantWithLanes(reg);
  if (!participantId) {
    return jsonResult({
      success: false,
      message:
        'No participant with at least 2 lanes found. ' +
        'Use create_bpmn_lanes to add lanes first, or specify participantId explicitly.',
    });
  }

  const pool = requireElement(reg, participantId);
  if (pool.type !== 'bpmn:Participant') {
    throw typeMismatchError(participantId, pool.type, ['bpmn:Participant']);
  }

  const lanes = getLanes(reg, participantId);
  if (lanes.length < 2) {
    return jsonResult({
      success: false,
      message: `Pool "${pool.businessObject?.name || participantId}" has ${lanes.length} lane(s). Need at least 2 lanes to redistribute.`,
    });
  }

  // ── Validate mode: run validation before and after ──────────────────────
  if (validate) {
    const result = await validateAndRedistribute(
      diagram,
      diagramId,
      participantId,
      lanes,
      getFlowNodes(reg, participantId),
      strategy,
      reposition,
      dryRun,
      reg,
      modeling,
      buildCurrentLaneMap,
      collectMoves
    );
    return dryRun ? result : appendLintFeedback(result, diagram);
  }

  // ── Standard redistribution (no validation wrapper) ─────────────────────
  const laneMap = buildCurrentLaneMap(lanes);
  const flowNodes = getFlowNodes(reg, participantId);
  const moves = collectMoves(flowNodes, strategy, lanes, laneMap, dryRun, reposition, modeling);

  if (!dryRun && moves.length > 0) {
    await syncXml(diagram);
  }

  const result = buildRedistributeResult(
    moves,
    flowNodes.length,
    dryRun,
    strategy,
    participantId,
    pool
  );
  return dryRun ? result : appendLintFeedback(result, diagram);
}

// ── Tool definition ────────────────────────────────────────────────────────

export const TOOL_DEFINITION = {
  name: 'redistribute_bpmn_elements_across_lanes',
  description:
    'Rebalance element placement across existing lanes in a pool. Analyzes assignee/role patterns, ' +
    'flow-neighbor connections, and lane capacity to produce a better distribution. ' +
    'Use when lanes become overcrowded or when elements are not optimally assigned after initial creation. ' +
    'Set validate=true to run lane validation before and after redistribution, reporting before/after ' +
    'coherence metrics and skipping changes when organization is already good (the optimize flow). ' +
    'Supports dry-run mode to preview changes before applying them.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      participantId: {
        type: 'string',
        description:
          'The ID of the participant (pool) whose lanes to rebalance. ' +
          'When omitted, auto-detects the first participant with at least 2 lanes.',
      },
      strategy: {
        type: 'string',
        enum: ['role-based', 'balance', 'minimize-crossings'],
        description:
          "Redistribution strategy: 'role-based' (default) matches assignee/candidateGroups to lane names; " +
          "'balance' spreads elements evenly while respecting roles; " +
          "'minimize-crossings' minimizes cross-lane sequence flows.",
      },
      reposition: {
        type: 'boolean',
        description:
          'When true (default), repositions elements vertically into their new lane bounds. ' +
          'Set to false to only update lane membership without moving elements.',
      },
      dryRun: {
        type: 'boolean',
        description: 'When true, returns the redistribution plan without applying any changes.',
      },
      validate: {
        type: 'boolean',
        description:
          'When true, runs lane validation before and after redistribution. ' +
          'Skips changes if organization is already good (coherence ≥ 70%). ' +
          'Reports before/after coherence metrics showing the improvement. ' +
          'Uses minimize-crossings strategy by default in validate mode.',
      },
    },
    required: ['diagramId'],
  },
} as const;
