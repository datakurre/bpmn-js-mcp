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
import { handleValidateLaneOrganization } from './analyze-lanes';
import { removeFromAllLanes, addToLane } from '../lane-helpers';

// ══════════════════════════════════════════════════════════════════════════════
// Inlined from auto-distribute.ts
// ══════════════════════════════════════════════════════════════════════════════
// ── Types ──────────────────────────────────────────────────────────────────

export interface AutoDistributeResult {
  assignedCount: number;
  assignments: Record<string, string[]>;
  unassigned: string[];
}

export type NameToLaneMap = Map<string, { laneId: string; index: number }>;

// ── Classification helpers ─────────────────────────────────────────────────

/** Element types that are flow-control (gateways, events) rather than work items. */
export function isFlowControl(type: string): boolean {
  return type.includes('Gateway') || type.includes('Event');
}

/** BPMN types considered "human" tasks. */
const HUMAN_TASK_TYPES = new Set(['bpmn:UserTask', 'bpmn:ManualTask']);

/** BPMN types considered "automated" tasks. */
const AUTO_TASK_TYPES = new Set([
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:CallActivity',
]);

/**
 * Extract the primary role (assignee or first candidateGroup) from a flow node
 * business object. Returns null when no role assignment is found.
 */
export function extractPrimaryRole(node: any): string | null {
  const assignee = node.$attrs?.['camunda:assignee'] ?? node.assignee;
  if (assignee && typeof assignee === 'string' && assignee.trim()) {
    return assignee.trim();
  }
  const candidateGroups = node.$attrs?.['camunda:candidateGroups'] ?? node.candidateGroups;
  if (candidateGroups) {
    const first = String(candidateGroups).split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
}

// ── Lane manipulation helpers ──────────────────────────────────────────────

/** Reposition an element vertically to center within lane bounds. */
function repositionElementInLane(modeling: any, element: any, lane: any): void {
  const laneCenterY = lane.y + (lane.height || 0) / 2;
  const elCenterY = element.y + (element.height || 0) / 2;
  const dy = laneCenterY - elCenterY;
  if (Math.abs(dy) > 0.5) {
    modeling.moveElements([element], { x: 0, y: dy });
  }
}

// ── Assignment phases ──────────────────────────────────────────────────────

/** Build a case-insensitive name→laneId map. */
export function buildNameToLaneMap(laneIds: string[], laneNames: string[]): NameToLaneMap {
  const map: NameToLaneMap = new Map();
  for (let i = 0; i < laneNames.length; i++) {
    map.set(laneNames[i].toLowerCase(), { laneId: laneIds[i], index: i });
  }
  return map;
}

/** Phase 1: Match elements to lanes by role (assignee/candidateGroups). */
export function assignByRole(
  flowNodes: any[],
  nameToLane: NameToLaneMap,
  elementToLane: Map<string, string>
): void {
  for (const node of flowNodes) {
    if (isFlowControl(node.$type)) continue;
    const role = extractPrimaryRole(node);
    if (role) {
      const match = nameToLane.get(role.toLowerCase());
      if (match) elementToLane.set(node.id, match.laneId);
    }
  }
}

/** Find a lane whose name contains one of the hint substrings (case-insensitive). */
function findLaneByHints(
  nameToLane: Map<string, { laneId: string; index: number }>,
  hints: string[]
): string | null {
  for (const [name, { laneId }] of nameToLane) {
    for (const hint of hints) {
      if (name.includes(hint)) return laneId;
    }
  }
  return null;
}

/** Phase 2: Type-based fallback for unmatched task elements. */
export function assignByType(
  flowNodes: any[],
  nameToLane: NameToLaneMap,
  elementToLane: Map<string, string>,
  laneIds: string[]
): void {
  const unmatched = flowNodes.filter(
    (n: any) => !elementToLane.has(n.id) && !isFlowControl(n.$type)
  );
  if (unmatched.length === 0 || laneIds.length < 2) return;

  const humanLaneId = findLaneByHints(nameToLane, ['human', 'manual', 'user', 'review']);
  const autoLaneId = findLaneByHints(nameToLane, [
    'auto',
    'system',
    'service',
    'script',
    'external',
  ]);

  for (const node of unmatched) {
    if (humanLaneId && HUMAN_TASK_TYPES.has(node.$type)) {
      elementToLane.set(node.id, humanLaneId);
    } else if (autoLaneId && AUTO_TASK_TYPES.has(node.$type)) {
      elementToLane.set(node.id, autoLaneId);
    } else {
      elementToLane.set(node.id, laneIds[0]);
    }
  }
}

/** Pick the lane with the most votes from a flow-control element's connections. */
function voteBestLane(el: any, elementToLane: Map<string, string>): string | null {
  const votes = new Map<string, number>();
  for (const f of el.incoming || []) {
    const lane = elementToLane.get(f.sourceRef?.id);
    if (lane) votes.set(lane, (votes.get(lane) || 0) + 2);
  }
  for (const f of el.outgoing || []) {
    const lane = elementToLane.get(f.targetRef?.id);
    if (lane) votes.set(lane, (votes.get(lane) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [lane, n] of votes) {
    if (n > bestN) {
      bestN = n;
      best = lane;
    }
  }
  return best;
}

/** Phase 3: Assign gateways/events based on most-connected neighbor's lane. */
export function assignFlowControlElements(
  flowNodes: any[],
  elementToLane: Map<string, string>,
  laneIds: string[]
): void {
  const controls = flowNodes.filter((n: any) => isFlowControl(n.$type));
  for (let pass = 0; pass < 3; pass++) {
    for (const el of controls) {
      if (elementToLane.has(el.id)) continue;
      const best = voteBestLane(el, elementToLane);
      if (best) elementToLane.set(el.id, best);
    }
  }
  // Assign remaining controls to first lane
  for (const el of controls) {
    if (!elementToLane.has(el.id)) elementToLane.set(el.id, laneIds[0]);
  }
}

/** Execute lane assignments: update flowNodeRef and reposition elements. */
function executeAssignments(
  diagram: any,
  flowNodes: any[],
  elementToLane: Map<string, string>
): AutoDistributeResult {
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const assignments: Record<string, string[]> = {};
  let assignedCount = 0;
  const unassigned: string[] = [];

  for (const node of flowNodes) {
    const laneId = elementToLane.get(node.id);
    if (!laneId) {
      unassigned.push(node.id);
      continue;
    }
    const shape = elementRegistry.get(node.id);
    const lane = elementRegistry.get(laneId);
    if (!shape || !lane) {
      unassigned.push(node.id);
      continue;
    }
    removeFromAllLanes(elementRegistry, node);
    addToLane(lane, node);
    repositionElementInLane(modeling, shape, lane);

    if (!assignments[laneId]) assignments[laneId] = [];
    assignments[laneId].push(node.id);
    assignedCount++;
  }
  return { assignedCount, assignments, unassigned };
}

// ── Main orchestrator ──────────────────────────────────────────────────────

/**
 * Automatically distribute existing elements in a participant to the given lanes.
 * Strategy:
 * 1. Role-based: match lane names to camunda:assignee / candidateGroups (case-insensitive)
 * 2. Type-based fallback: group human tasks vs automated tasks
 * 3. Flow-control: assign gateways/events to their most-connected neighbor's lane
 */
export function autoDistributeElements(
  diagram: any,
  participant: any,
  laneIds: string[],
  laneNames: string[]
): AutoDistributeResult {
  const process = participant.businessObject?.processRef;
  if (!process) return { assignedCount: 0, assignments: {}, unassigned: [] };

  const flowElements: any[] = process.flowElements || [];
  const flowNodes = flowElements.filter(
    (el: any) => !el.$type.includes('SequenceFlow') && !el.$type.includes('Association')
  );

  if (flowNodes.length === 0) return { assignedCount: 0, assignments: {}, unassigned: [] };

  const nameToLane = buildNameToLaneMap(laneIds, laneNames);
  const elementToLane = new Map<string, string>();

  // Phase 1–3: build the assignment map
  assignByRole(flowNodes, nameToLane, elementToLane);
  assignByType(flowNodes, nameToLane, elementToLane, laneIds);
  assignFlowControlElements(flowNodes, elementToLane, laneIds);

  // Execute assignments: update flowNodeRef and reposition
  return executeAssignments(diagram, flowNodes, elementToLane);
}
// ══════════════════════════════════════════════════════════════════════════════
// Inlined from validate-and-redistribute.ts
// ══════════════════════════════════════════════════════════════════════════════
// ── Redistribute result builder ────────────────────────────────────────────

export function buildRedistributeResult(
  moves: any[],
  totalElements: number,
  dryRun: boolean,
  strategy: string,
  participantId: string,
  pool: any
): ToolResult {
  const msg = dryRun
    ? `Dry run: would move ${moves.length} of ${totalElements} element(s) using "${strategy}" strategy.`
    : `Moved ${moves.length} of ${totalElements} element(s) using "${strategy}" strategy.`;
  return jsonResult({
    success: true,
    dryRun,
    strategy,
    participantId,
    participantName: pool.businessObject?.name || participantId,
    movedCount: moves.length,
    totalElements,
    moves,
    message: msg,
    nextSteps:
      moves.length > 0
        ? [
            {
              tool: 'layout_bpmn_diagram',
              description: 'Re-layout diagram after lane redistribution',
            },
            {
              tool: 'analyze_bpmn_lanes',
              description: 'Check if the new lane organization is coherent (mode: validate)',
            },
          ]
        : [],
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Find the first participant that has at least 2 lanes. */
export function findParticipantWithLanes(elementRegistry: any): string | null {
  const participants = elementRegistry.filter((el: any) => el.type === PARTICIPANT_TYPE);
  for (const p of participants) {
    const lanes = elementRegistry.filter(
      (el: any) => el.type === 'bpmn:Lane' && el.parent?.id === p.id
    );
    if (lanes.length >= 2) return p.id;
  }
  return null;
}

/** Parse JSON from an MCP tool result. */
function parseToolResult(result: ToolResult): any {
  return JSON.parse(result.content[0].text as string);
}

/** Extract the list of fixable issue codes from validation data. */
function getFixableIssues(validationData: any): any[] {
  return (validationData.issues || []).filter(
    (i: any) =>
      i.code === 'zigzag-flow' || i.code === 'low-coherence' || i.code === 'elements-not-in-lane'
  );
}

/** Build a coherence-metrics summary object. */
function coherenceMetrics(data: any): {
  coherenceScore: number;
  crossLaneFlows: number;
  intraLaneFlows: number;
} {
  return {
    coherenceScore: data.coherenceScore,
    crossLaneFlows: data.crossLaneFlows,
    intraLaneFlows: data.intraLaneFlows,
  };
}

// ── Validate-result builder ────────────────────────────────────────────────

function buildValidateResult(
  moves: any[],
  totalElements: number,
  dryRun: boolean,
  strategy: string,
  participantId: string,
  beforeData: any,
  afterData: any
): ToolResult {
  const resultData: any = {
    success: true,
    optimized: true,
    dryRun,
    strategy,
    participantId,
    movedCount: moves.length,
    totalElements,
    moves,
    before: coherenceMetrics(beforeData),
    ...(afterData
      ? {
          after: coherenceMetrics(afterData),
          improvement: afterData.coherenceScore - beforeData.coherenceScore,
        }
      : {}),
    message: dryRun
      ? `Dry run: would move ${moves.length} element(s) to improve lane assignments.`
      : `Optimized lane assignments: moved ${moves.length} element(s). ` +
        `Coherence: ${beforeData.coherenceScore}% → ${afterData?.coherenceScore ?? '?'}%.`,
    nextSteps: dryRun
      ? [
          {
            tool: 'analyze_bpmn_lanes',
            description:
              'Run again with mode: redistribute and dryRun: false to apply the changes.',
          },
        ]
      : [
          {
            tool: 'layout_bpmn_diagram',
            description: 'Re-layout diagram after lane optimization for clean visual positioning.',
          },
        ],
  };
  return jsonResult(resultData);
}

// ── Main validate-and-redistribute flow ────────────────────────────────────

export async function validateAndRedistribute(
  diagram: any,
  diagramId: string,
  participantId: string,
  lanes: any[],
  flowNodes: any[],
  strategy: string,
  reposition: boolean,
  dryRun: boolean,
  _reg: any,
  modeling: any,
  buildCurrentLaneMap: (lanes: any[]) => Map<string, any>,
  collectMoves: (
    flowNodes: any[],
    strategy: string,
    lanes: any[],
    laneMap: Map<string, any>,
    dryRun: boolean,
    reposition: boolean,
    modeling: any
  ) => any[]
): Promise<ToolResult> {
  const beforeData = parseToolResult(
    await handleValidateLaneOrganization({ diagramId, participantId })
  );
  const fixableIssues = getFixableIssues(beforeData);

  if (fixableIssues.length === 0 && beforeData.coherenceScore >= 70) {
    return jsonResult({
      success: true,
      optimized: false,
      message: `Lane organization is already good (coherence: ${beforeData.coherenceScore}%). No optimization needed.`,
      ...coherenceMetrics(beforeData),
    });
  }

  const laneMap = buildCurrentLaneMap(lanes);
  const effectiveStrategy = strategy === 'role-based' ? 'minimize-crossings' : strategy;
  const moves = collectMoves(
    flowNodes,
    effectiveStrategy,
    lanes,
    laneMap,
    dryRun,
    reposition,
    modeling
  );

  if (moves.length === 0) {
    return jsonResult({
      success: true,
      optimized: false,
      message: `No elements could be moved to improve lane assignments (coherence: ${beforeData.coherenceScore}%).`,
      ...coherenceMetrics(beforeData),
      issues: fixableIssues,
    });
  }

  let afterData: any = null;
  if (!dryRun) {
    await syncXml(diagram);
    afterData = parseToolResult(await handleValidateLaneOrganization({ diagramId, participantId }));
  }

  return buildValidateResult(
    moves,
    flowNodes.length,
    dryRun,
    effectiveStrategy,
    participantId,
    beforeData,
    afterData
  );
}
// ══════════════════════════════════════════════════════════════════════════════
// Main handler
// ══════════════════════════════════════════════════════════════════════════════
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

/** Reusable constant to avoid duplicate string literals (sonarjs/no-duplicate-string). */
const PARTICIPANT_TYPE = 'bpmn:Participant';

const NON_ASSIGNABLE = new Set([
  PARTICIPANT_TYPE,
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

function removeFromRedistLanes(lanes: LaneInfo[], bo: any): void {
  for (const lane of lanes) {
    const refs = lane.element.businessObject?.flowNodeRef;
    if (!Array.isArray(refs)) continue;
    const idx = refs.indexOf(bo);
    if (idx >= 0) refs.splice(idx, 1);
  }
}

function addToRedistLane(lane: LaneInfo, bo: any): void {
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
  removeFromRedistLanes(lanes, bo);
  addToRedistLane(target, bo);
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

// ── Empty lane detection (TODO #6) ────────────────────────────────────────

/**
 * Return IDs of lanes in the given participant that have zero flowNodeRef entries.
 * Called after redistribution to surface lanes that can be safely deleted.
 */
export function findEmptyLaneIds(reg: any, participantId: string): string[] {
  const lanes: any[] = reg.filter(
    (el: any) => el.type === 'bpmn:Lane' && el.parent?.id === participantId
  );
  return lanes
    .filter((l: any) => {
      const refs = l.businessObject?.flowNodeRef;
      return !Array.isArray(refs) || refs.length === 0;
    })
    .map((l: any) => l.id as string);
}

/**
 * Build nextStep entries for each empty lane — suggests calling
 * delete_bpmn_element for each to clean up the diagram.
 */
export function buildEmptyLaneNextSteps(
  emptyLaneIds: string[],
  reg: any
): Array<{ tool: string; description: string; args?: Record<string, unknown> }> {
  return emptyLaneIds.map((laneId) => {
    const lane: any = reg.get(laneId);
    const name = lane?.businessObject?.name || laneId;
    return {
      tool: 'delete_bpmn_element',
      description: `Delete empty lane "${name}" (${laneId}) — it has no elements after redistribution.`,
      args: { elementId: laneId },
    };
  });
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
  if (pool.type !== PARTICIPANT_TYPE) {
    throw typeMismatchError(participantId, pool.type, [PARTICIPANT_TYPE]);
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
  return runStandardRedistribution(args, diagram, reg, modeling, participantId, pool, lanes);
}

/**
 * Run the standard (non-validate) redistribution path and build the result.
 * Extracted to keep `handleRedistributeElementsAcrossLanes` within the line/
 * complexity limits (TODO #6: adds empty-lane nextStep detection).
 */
async function runStandardRedistribution(
  args: RedistributeElementsAcrossLanesArgs,
  diagram: any,
  reg: any,
  modeling: any,
  participantId: string,
  pool: any,
  lanes: LaneInfo[]
): Promise<ToolResult> {
  const { strategy = 'role-based', reposition = true, dryRun = false } = args;
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

  if (dryRun) return result;

  // TODO #6: append nextSteps for empty lanes after redistribution
  if (moves.length > 0) {
    const emptyLaneIds = findEmptyLaneIds(reg, participantId);
    if (emptyLaneIds.length > 0) {
      const parsed = JSON.parse(result.content[0].text as string);
      const emptySteps = buildEmptyLaneNextSteps(emptyLaneIds, reg);
      const existing: any[] = parsed.nextSteps ?? [];
      return appendLintFeedback(
        jsonResult({ ...parsed, nextSteps: [...existing, ...emptySteps] }),
        diagram
      );
    }
  }

  return appendLintFeedback(result, diagram);
}

// Schema extracted to redistribute-elements-schema.ts for readability.
export { TOOL_DEFINITION } from './redistribute-elements-schema';
