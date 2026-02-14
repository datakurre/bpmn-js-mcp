/**
 * Auto-distribute helpers for create_bpmn_lanes.
 *
 * Assigns existing flow elements to lanes based on:
 * 1. Role matching (camunda:assignee / candidateGroups ↔ lane name)
 * 2. Type-based fallback (human tasks vs automated tasks)
 * 3. Flow-control voting (gateways/events follow their neighbors)
 */

import { getService } from '../helpers';

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

/** Remove an element BO from all lanes' flowNodeRef lists. */
function removeFromAllLanes(elementRegistry: any, elementBo: any): void {
  const allLanes = elementRegistry.filter((el: any) => el.type === 'bpmn:Lane');
  for (const lane of allLanes) {
    const refs = lane.businessObject?.flowNodeRef;
    if (Array.isArray(refs)) {
      const idx = refs.indexOf(elementBo);
      if (idx >= 0) refs.splice(idx, 1);
    }
  }
}

/** Add an element BO to a lane's flowNodeRef list. */
function addToLane(lane: any, elementBo: any): void {
  const laneBo = lane.businessObject;
  if (!laneBo) return;
  const refs: unknown[] = (laneBo.flowNodeRef as unknown[] | undefined) || [];
  if (!laneBo.flowNodeRef) laneBo.flowNodeRef = refs;
  if (!refs.includes(elementBo)) refs.push(elementBo);
}

/** Reposition an element vertically to center within lane bounds. */
function repositionInLane(modeling: any, element: any, lane: any): void {
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
    repositionInLane(modeling, shape, lane);

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
