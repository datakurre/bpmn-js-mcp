/**
 * Handler for analyze_bpmn_lanes tool.
 *
 * Unified lane analysis — merges three former standalone tools:
 *   - suggest_bpmn_lane_organization  → mode: 'suggest'
 *   - validate_bpmn_lane_organization → mode: 'validate'
 *   - suggest_bpmn_pool_vs_lanes      → mode: 'pool-vs-lanes'
 */
// @readonly

import { type ToolResult } from '../../types';
import { requireDiagram, jsonResult, validateArgs } from '../helpers';
import { getService } from '../../bpmn-types';
import { findProcess } from './collaboration-utils';

export interface AnalyzeLanesArgs {
  diagramId: string;
  mode: 'suggest' | 'validate' | 'pool-vs-lanes';
  participantId?: string;
}

// ══════════════════════════════════════════════════════════════════════
// suggest mode — was suggest-lane-organization.ts
// ══════════════════════════════════════════════════════════════════════
export interface SuggestLaneOrganizationArgs {
  diagramId: string;
  /** Optional participant ID to scope the analysis. When omitted, uses the first process. */
  participantId?: string;
}

/** A suggested lane assignment. */
interface LaneSuggestion {
  laneName: string;
  description: string;
  elementIds: string[];
  elementNames: string[];
  reasoning: string;
}

/** Predefined task categories for lane grouping. */
const TASK_CATEGORIES = [
  {
    name: 'Human Tasks',
    description: 'Tasks requiring human interaction (forms, reviews, approvals)',
    types: ['bpmn:UserTask', 'bpmn:ManualTask'],
  },
  {
    name: 'Automated Tasks',
    description: 'Tasks executed by systems or services',
    types: ['bpmn:ServiceTask', 'bpmn:ScriptTask', 'bpmn:BusinessRuleTask', 'bpmn:SendTask'],
  },
  {
    name: 'External Interactions',
    description: 'Tasks involving external system calls or message exchanges',
    types: ['bpmn:ReceiveTask', 'bpmn:CallActivity'],
  },
] as const;

/** Connection types to skip when analyzing flows. */
const CONNECTION_TYPES = new Set([
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Association',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
]);

// ── Role extraction ────────────────────────────────────────────────────────

/**
 * Return true when a string looks like a UEL/EL expression (e.g. "${initiator}").
 * Such expressions are not meaningful as human-readable lane names.
 */
function isElExpression(value: string): boolean {
  const v = value.trim();
  return v.startsWith('${') || v.startsWith('#{');
}

/**
 * Extract the primary role (assignee or first candidateGroup) from a flow node.
 * Returns null when no role assignment is found.
 *
 * Priority:
 *   1. `camunda:candidateGroups` — first group (preferred: human-readable role)
 *   2. `camunda:assignee` — only when it is NOT an EL expression like "${initiator}"
 */
function extractPrimaryRoleSuggest(node: any): string | null {
  // Prefer candidateGroups (role name) over assignee (often an EL expression)
  const candidateGroups = node.$attrs?.['camunda:candidateGroups'] ?? node.candidateGroups;
  if (candidateGroups) {
    const first = String(candidateGroups).split(',')[0]?.trim();
    if (first) return first;
  }

  // Fall back to assignee only when it is a literal name, not an EL expression
  const assignee = node.$attrs?.['camunda:assignee'] ?? node.assignee;
  if (assignee && typeof assignee === 'string' && assignee.trim() && !isElExpression(assignee)) {
    return assignee.trim();
  }

  return null;
}

/**
 * Collect distinct roles from all flow nodes.
 * Returns a map of role → element IDs assigned to that role.
 */
function collectRoleAssignments(flowNodes: any[]): Map<string, any[]> {
  const roleMap = new Map<string, any[]>();
  for (const node of flowNodes) {
    const role = extractPrimaryRoleSuggest(node);
    if (role) {
      const list = roleMap.get(role) || [];
      list.push(node);
      roleMap.set(role, list);
    }
  }
  return roleMap;
}

/**
 * Build lane suggestions based on camunda:assignee / camunda:candidateGroups.
 * Returns suggestions only when at least 2 distinct roles are found.
 */
function buildRoleSuggestions(
  flowNodes: any[],
  laneMap: Map<string, string>
): LaneSuggestion[] | null {
  const roleAssignments = collectRoleAssignments(flowNodes);

  // Need at least 2 distinct roles for role-based grouping to be useful
  if (roleAssignments.size < 2) return null;

  const suggestions: LaneSuggestion[] = [];
  const assignedIds = new Set<string>();

  for (const [role, elements] of roleAssignments) {
    const ids = elements.map((e: any) => e.id);
    ids.forEach((id: string) => {
      laneMap.set(id, role);
      assignedIds.add(id);
    });

    const types = [...new Set(elements.map((e: any) => e.$type))].join(', ');
    suggestions.push({
      laneName: role,
      description: `Tasks assigned to "${role}"`,
      elementIds: ids,
      elementNames: elements.map((e: any) => e.name || e.id),
      reasoning: `${elements.length} element(s) of type(s) ${types} share the assignee/candidateGroup "${role}".`,
    });
  }

  // Collect unassigned non-flow-control elements into an "Unassigned" group.
  // Exclude compensation handler tasks (isForCompensation=true) — they are not
  // part of the normal flow and should not be grouped into task lanes.
  const unassigned = flowNodes.filter(
    (n: any) => !assignedIds.has(n.id) && !isFlowControlSuggest(n.$type) && !n.isForCompensation
  );
  if (unassigned.length > 0) {
    const ids = unassigned.map((e: any) => e.id);
    // Detect whether unassigned elements are all automated task types.
    // When they are, name the lane "Automated Tasks" to match their semantic
    // purpose rather than the unhelpful generic label "Unassigned".
    const automatedTypes = new Set([
      'bpmn:ServiceTask',
      'bpmn:ScriptTask',
      'bpmn:BusinessRuleTask',
      'bpmn:SendTask',
      'bpmn:ReceiveTask',
    ]);
    const allAutomated = unassigned.every((n: any) => automatedTypes.has(n.$type));
    const groupName = allAutomated ? 'Automated Tasks' : 'Unassigned';
    const groupDesc = allAutomated
      ? 'Automated tasks executed by systems or external workers (no human assignee)'
      : 'Tasks without explicit assignee or candidateGroup';
    const groupReasoning = allAutomated
      ? `${unassigned.length} automated task(s) (ServiceTask / ScriptTask) — consider assigning them to a "System" or "Automated Tasks" lane.`
      : `${unassigned.length} element(s) lack a camunda:assignee or camunda:candidateGroups. Consider assigning them to a role.`;
    // Use the group name as the laneMap key so coherence is computed correctly
    ids.forEach((id: string) => laneMap.set(id, groupName));
    suggestions.push({
      laneName: groupName,
      description: groupDesc,
      elementIds: ids,
      elementNames: unassigned.map((e: any) => e.name || e.id),
      reasoning: groupReasoning,
    });
  }

  return suggestions;
}

/** Check if a flow node type is a gateway or event (flow control elements). */
function isFlowControlSuggest(type: string): boolean {
  return type.includes('Gateway') || type.includes('Event') || type === 'bpmn:Task';
}

/** Categorize a flow node by its BPMN type. Returns category name or null. */
function categorizeElement(type: string): string | null {
  for (const cat of TASK_CATEGORIES) {
    if ((cat.types as readonly string[]).includes(type)) return cat.name;
  }
  return null;
}

/** Calculate coherence score for suggested lane assignments. */
function calculateCoherence(
  sequenceFlows: any[],
  laneMap: Map<string, string>
): { coherence: number; crossLane: number; intraLane: number } {
  let crossLane = 0;
  let intraLane = 0;
  for (const flow of sequenceFlows) {
    const sLane = laneMap.get(flow.sourceRef?.id);
    const tLane = laneMap.get(flow.targetRef?.id);
    if (!sLane || !tLane) continue;
    if (sLane === tLane) intraLane++;
    else crossLane++;
  }
  const total = intraLane + crossLane;
  return {
    coherence: total > 0 ? Math.round((intraLane / total) * 100) : 100,
    crossLane,
    intraLane,
  };
}

/** Count lane votes from an element's incoming and outgoing flows. */
function countLaneVotesSuggest(el: any, laneMap: Map<string, string>): Map<string, number> {
  const votes = new Map<string, number>();
  for (const f of el.incoming || []) {
    const lane = laneMap.get(f.sourceRef?.id);
    if (lane) {
      votes.set(lane, (votes.get(lane) || 0) + 2);
    }
  }
  for (const f of el.outgoing || []) {
    const lane = laneMap.get(f.targetRef?.id);
    if (lane) {
      votes.set(lane, (votes.get(lane) || 0) + 1);
    }
  }
  return votes;
}

/** Pick the lane with the highest vote count. */
function pickBestLaneSuggest(votes: Map<string, number>): string | null {
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

/** Assign gateways and events to their most-connected neighbor's lane. */
function assignFlowControlToLanesSuggest(flowElements: any[], laneMap: Map<string, string>): void {
  const controls = flowElements.filter(
    (el: any) => isFlowControlSuggest(el.$type) && !laneMap.has(el.id)
  );
  for (let pass = 0; pass < 3; pass++) {
    for (const el of controls) {
      if (laneMap.has(el.id)) {
        continue;
      }
      const best = pickBestLaneSuggest(countLaneVotesSuggest(el, laneMap));
      if (best) {
        laneMap.set(el.id, best);
      }
    }
  }
}

/** Group flow nodes by their BPMN-type category. */
function groupByCategory(flowNodes: any[]): { groups: Map<string, any[]>; uncategorized: any[] } {
  const groups = new Map<string, any[]>();
  const uncategorized: any[] = [];
  for (const node of flowNodes) {
    const cat = categorizeElement(node.$type);
    if (cat) {
      const g = groups.get(cat) || [];
      g.push(node);
      groups.set(cat, g);
    } else if (!isFlowControlSuggest(node.$type)) {
      uncategorized.push(node);
    }
  }
  return { groups, uncategorized };
}

/** Build a LaneSuggestion for one category group. */
function buildGroupSuggestion(
  catName: string,
  elements: any[],
  laneMap: Map<string, string>
): LaneSuggestion {
  const cat = TASK_CATEGORIES.find((c) => c.name === catName);
  const ids = elements.map((e: any) => e.id);
  ids.forEach((id: string) => laneMap.set(id, catName));
  const types = [...new Set(elements.map((e: any) => e.$type))].join(', ');
  return {
    laneName: catName,
    description: cat?.description || '',
    elementIds: ids,
    elementNames: elements.map((e: any) => e.name || e.id),
    reasoning: `${elements.length} element(s) of type(s) ${types} grouped by role pattern.`,
  };
}

/** Categorize flow nodes and build lane suggestions. */
function buildCategorySuggestions(
  flowNodes: any[],
  laneMap: Map<string, string>
): LaneSuggestion[] {
  const { groups, uncategorized } = groupByCategory(flowNodes);
  const suggestions: LaneSuggestion[] = [];
  for (const [catName, elements] of groups) {
    if (elements.length === 0) {
      continue;
    }
    suggestions.push(buildGroupSuggestion(catName, elements, laneMap));
  }
  if (uncategorized.length > 0) {
    const ids = uncategorized.map((e: any) => e.id);
    ids.forEach((id: string) => laneMap.set(id, 'General Tasks'));
    suggestions.push({
      laneName: 'General Tasks',
      description: 'Tasks without a specific type classification',
      elementIds: ids,
      elementNames: uncategorized.map((e: any) => e.name || e.id),
      reasoning: `${uncategorized.length} untyped task(s).`,
    });
  }
  return suggestions;
}

/** Append flow-control elements to their assigned suggestion. */
function appendFlowControlToSuggestions(
  flowNodes: any[],
  laneMap: Map<string, string>,
  suggestions: LaneSuggestion[]
): void {
  for (const node of flowNodes) {
    if (!isFlowControlSuggest(node.$type) || !laneMap.has(node.id)) continue;
    const s = suggestions.find((sg) => sg.laneName === laneMap.get(node.id));
    if (s && !s.elementIds.includes(node.id)) {
      s.elementIds.push(node.id);
      s.elementNames.push(node.name || node.id);
    }
  }
}

/** Build a recommendation string based on the analysis. */
function buildRecommendation(
  count: number,
  coherence: number,
  intraLane: number,
  crossLane: number
): string {
  if (count === 0) {
    return 'No categorizable tasks found. Add typed tasks (UserTask, ServiceTask, etc.) to enable lane suggestions.';
  }
  if (count === 1) {
    return 'All tasks fall into a single category — lanes may not add value. Consider adding different task types or organizing by business role instead.';
  }
  const stats = `${coherence}% coherence (${intraLane} intra-lane vs ${crossLane} cross-lane flows)`;
  if (coherence >= 70) {
    return `Suggested organization achieves ${stats}. This is a good lane structure. Use create_bpmn_lanes (lanes, then assignments) to apply.`;
  }
  return `Suggested organization achieves ${stats}. Consider organizing by business role (e.g. "Requester", "Approver", "System") rather than task type for better flow coherence.`;
}

/** Build currentLanes info and actionable nextSteps for suggest mode. */
function buildSuggestLanesAndNextSteps(
  process: any,
  flowElements: any[],
  suggestions: Array<{ laneName: string; elementIds: string[] }>,
  args: SuggestLaneOrganizationArgs
): {
  currentLanes: { name: string; elementCount: number }[];
  nextSteps: Array<{ tool: string; description: string; args: Record<string, unknown> }>;
} {
  const currentLanes: { name: string; elementCount: number }[] = [];
  const existingLaneIdByName = new Map<string, string>();
  const laneSets = (process.laneSets ?? []) as Array<{
    lanes?: Array<{ name?: string; id?: string; flowNodeRef?: unknown[] }>;
  }>;
  for (const ls of laneSets) {
    for (const lane of ls.lanes || []) {
      const laneName = lane.name || lane.id || '(unnamed)';
      currentLanes.push({
        name: laneName,
        // Exclude BoundaryEvents (inherit host's lane) and compensation handlers
        // from the displayed count to match totalFlowNodes from suggest mode.
        elementCount: (lane.flowNodeRef || []).filter((ref: any) => {
          const refObj =
            typeof ref === 'string' ? flowElements.find((e: any) => e.id === ref) : ref;
          return refObj && refObj.$type !== 'bpmn:BoundaryEvent' && !refObj.isForCompensation;
        }).length,
      });
      if (lane.id) existingLaneIdByName.set(laneName, lane.id);
    }
  }

  // Build actionable nextSteps so the AI agent can apply the suggestions directly:
  // one create-and-assign step when the pool has no lanes yet, otherwise one
  // batched `assignments` step for the existing lanes.
  const nextSteps: Array<{ tool: string; description: string; args: Record<string, unknown> }> = [];
  if (currentLanes.length === 0) {
    if (suggestions.length >= 2) {
      nextSteps.push({
        tool: 'create_bpmn_lanes',
        description: `Create ${suggestions.length} suggested lane(s) and assign their elements`,
        args: {
          diagramId: args.diagramId,
          participantId: args.participantId,
          distributeStrategy: 'manual',
          lanes: suggestions.map((s) => ({ name: s.laneName, elementIds: s.elementIds })),
        },
      });
    }
  } else {
    const assignments = suggestions.flatMap((s) => {
      const laneId = existingLaneIdByName.get(s.laneName);
      return laneId ? [{ laneId, elementIds: s.elementIds }] : [];
    });
    if (assignments.length > 0) {
      nextSteps.push({
        tool: 'create_bpmn_lanes',
        description: `Assign elements to ${assignments.length} existing lane(s)`,
        args: { diagramId: args.diagramId, assignments },
      });
    }
  }

  return { currentLanes, nextSteps };
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleSuggestLaneOrganization(
  args: SuggestLaneOrganizationArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);

  const diagram = requireDiagram(args.diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const canvas = getService(diagram.modeler, 'canvas');
  const process = findProcess(elementRegistry, canvas, args.participantId);
  if (!process) return jsonResult({ error: 'No process found in diagram', suggestions: [] });

  const flowElements: any[] = process.flowElements || [];
  const flowNodes = flowElements.filter(
    (el: any) =>
      !el.$type.includes('SequenceFlow') &&
      !CONNECTION_TYPES.has(el.$type) &&
      // BoundaryEvents inherit their host task's lane membership — exclude to avoid
      // inflating totalFlowNodes and having them appear in role/type suggestions.
      // (Matches the exclusion in partitionFlowElements used by validate mode.)
      el.$type !== 'bpmn:BoundaryEvent' &&
      // Exclude compensation handler tasks — they are not part of the normal flow
      // and must not appear in lane suggestions (e.g. "Automated Tasks").
      !el.isForCompensation
  );
  const sequenceFlows = flowElements.filter((el: any) => el.$type === 'bpmn:SequenceFlow');

  const laneMap = new Map<string, string>();

  // Prefer role-based grouping (camunda:assignee / camunda:candidateGroups)
  // when at least 2 distinct roles are found. Fall back to type-based grouping.
  const roleSuggestions = buildRoleSuggestions(flowNodes, laneMap);
  const groupingStrategy = roleSuggestions ? 'role' : 'type';
  const suggestions = roleSuggestions ?? buildCategorySuggestions(flowNodes, laneMap);

  assignFlowControlToLanesSuggest(flowNodes, laneMap);
  appendFlowControlToSuggestions(flowNodes, laneMap, suggestions);

  const { coherence, crossLane, intraLane } = calculateCoherence(sequenceFlows, laneMap);
  const recommendation = buildRecommendation(suggestions.length, coherence, intraLane, crossLane);

  const { currentLanes, nextSteps } = buildSuggestLanesAndNextSteps(
    process,
    flowElements,
    suggestions,
    args
  );

  const result: Record<string, any> = {
    totalFlowNodes: flowNodes.length,
    groupingStrategy,
    suggestions,
    crossLaneFlows: crossLane,
    intraLaneFlows: intraLane,
    coherenceScore: coherence,
    coherenceNote:
      'coherenceScore reflects the proposed lane assignment (not the current one). ' +
      "Use mode: 'validate' to measure the current diagram's coherence.",
    recommendation,
    nextSteps,
  };
  if (currentLanes.length > 0) result.currentLanes = currentLanes;
  return jsonResult(result);
}
// ══════════════════════════════════════════════════════════════════════
// validate mode — was validate-lane-organization.ts
// ══════════════════════════════════════════════════════════════════════
export interface ValidateLaneOrganizationArgs {
  diagramId: string;
  /** Optional participant ID to scope the validation. When omitted, uses the first process. */
  participantId?: string;
}

/** A validation issue found in the lane organization. */
interface LaneIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  elementIds?: string[];
  suggestion?: string;
}

/** Result of the lane validation. */
interface ValidationResult {
  valid: boolean;
  totalLanes: number;
  totalFlowNodes: number;
  issues: LaneIssue[];
  coherenceScore: number;
  crossLaneFlows: number;
  intraLaneFlows: number;
  laneDetails: LaneDetail[];
}

/** Detail about a single lane. */
interface LaneDetail {
  laneId: string;
  laneName: string;
  elementCount: number;
  elementTypes: Record<string, number>;
}

/** Build a map of elementId → lane for fast lookup. */
function buildLaneMap(laneSets: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const laneSet of laneSets || []) {
    for (const lane of laneSet.lanes || []) {
      for (const ref of lane.flowNodeRef || []) {
        const refId = typeof ref === 'string' ? ref : ref.id;
        if (!map.has(refId)) map.set(refId, lane);
      }
    }
  }
  return map;
}

/** Get all lanes from lane sets. */
function getAllLanes(laneSets: any[]): any[] {
  const lanes: any[] = [];
  for (const laneSet of laneSets || []) {
    for (const lane of laneSet.lanes || []) lanes.push(lane);
  }
  return lanes;
}

/** Find the process business object from diagram services. */
/** Filter flow elements into flow nodes (non-flow) and sequence flows. */
function partitionFlowElements(flowElements: any[]): { flowNodes: any[]; sequenceFlows: any[] } {
  const flowNodes = flowElements.filter(
    (el: any) =>
      el.$type !== 'bpmn:SequenceFlow' &&
      // BoundaryEvents inherit their host task's lane — bpmn-js may or may not
      // add them to lane.flowNodeRef. Exclude them from lane membership checks
      // to avoid false-positive 'elements-not-in-lane' warnings and inflated
      // totalFlowNodes counts. (suggest mode already excludes them via
      // isFlowControlSuggest which matches 'Event' in the type string.)
      el.$type !== 'bpmn:BoundaryEvent' &&
      // Compensation handler tasks (isForCompensation=true) are connected via
      // compensation associations, not sequence flows. bpmn-js does not always
      // add them to lane.flowNodeRef, so they would be falsely flagged as
      // unassigned. They are also not part of the normal process flow.
      !el.isForCompensation &&
      !el.$type.includes('Association') &&
      !el.$type.includes('DataInput') &&
      !el.$type.includes('DataOutput')
  );
  const sequenceFlows = flowElements.filter((el: any) => el.$type === 'bpmn:SequenceFlow');
  return { flowNodes, sequenceFlows };
}

/** Build lane details with element counts and type distributions. */
function buildLaneDetails(lanes: any[], flowElements: any[]): LaneDetail[] {
  return lanes.map((lane: any) => {
    const refs = lane.flowNodeRef || [];
    // Exclude BoundaryEvents (inherit host's lane membership) and compensation
    // handler tasks (connected via associations, not normal flow) to align
    // elementCount with the totalFlowNodes reported by partitionFlowElements.
    const countableRefs = refs.filter((ref: any) => {
      const refObj = typeof ref === 'string' ? flowElements.find((e: any) => e.id === ref) : ref;
      return refObj && refObj.$type !== 'bpmn:BoundaryEvent' && !refObj.isForCompensation;
    });
    const typeCount: Record<string, number> = {};
    for (const ref of countableRefs) {
      const refObj = typeof ref === 'string' ? flowElements.find((e: any) => e.id === ref) : ref;
      if (refObj) {
        const t = refObj.$type || 'unknown';
        typeCount[t] = (typeCount[t] || 0) + 1;
      }
    }
    return {
      laneId: lane.id,
      laneName: lane.name || lane.id,
      elementCount: countableRefs.length,
      elementTypes: typeCount,
    };
  });
}

/** Check for single-element and empty lanes. */
function checkLanePopulation(laneDetails: LaneDetail[], issues: LaneIssue[]): void {
  for (const detail of laneDetails) {
    if (detail.elementCount === 0) {
      issues.push({
        severity: 'warning',
        code: 'lane-empty',
        message: `Lane "${detail.laneName}" is empty. Remove it or assign elements to it.`,
        elementIds: [detail.laneId],
        suggestion:
          'Use delete_bpmn_element to remove the empty lane, or create_bpmn_lanes with assignments to populate it.',
      });
    } else if (detail.elementCount <= 1) {
      issues.push({
        severity: 'info',
        code: 'lane-single-element',
        message: `Lane "${detail.laneName}" contains only ${detail.elementCount} element(s). Consider merging with another lane.`,
        elementIds: [detail.laneId],
        suggestion:
          "Consider using create_bpmn_lanes with assignments to merge this lane's elements into a related lane.",
      });
    }
  }
}

/** Check for elements not assigned to any lane. */
function checkUnassigned(flowNodes: any[], laneMap: Map<string, any>, issues: LaneIssue[]): void {
  const unassigned = flowNodes.filter((node: any) => !laneMap.has(node.id));
  if (unassigned.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'elements-not-in-lane',
      message: `${unassigned.length} flow node(s) are not assigned to any lane: ${unassigned.map((e: any) => e.name || e.id).join(', ')}`,
      elementIds: unassigned.map((e: any) => e.id),
      suggestion:
        'Use create_bpmn_lanes with assignments to assign these elements to appropriate lanes.',
    });
  }
}

/** Compute coherence (intra-lane vs cross-lane flow ratio). */
function computeCoherence(
  sequenceFlows: any[],
  laneMap: Map<string, any>
): { coherence: number; crossLane: number; intraLane: number } {
  let crossLane = 0;
  let intraLane = 0;
  for (const flow of sequenceFlows) {
    const sourceLane = laneMap.get(flow.sourceRef?.id);
    const targetLane = laneMap.get(flow.targetRef?.id);
    if (!sourceLane || !targetLane) continue;
    if (sourceLane.id === targetLane.id) intraLane++;
    else crossLane++;
  }
  const total = intraLane + crossLane;
  return {
    coherence: total > 0 ? Math.round((intraLane / total) * 100) : 100,
    crossLane,
    intraLane,
  };
}

/** Build a LaneIssue for a detected zigzag pattern. */
function buildZigzagIssue(
  node: any,
  nodeLane: any,
  pred: any,
  predLane: any,
  succ: any,
  succLane: any
): LaneIssue {
  const nName = node.name || node.id;
  const pName = `${pred.name || pred.id} (${predLane.name || predLane.id})`;
  const sName = `${succ.name || succ.id} (${succLane.name || succLane.id})`;
  return {
    severity: 'warning',
    code: 'zigzag-flow',
    message: `Zigzag flow: ${pName} → ${nName} (${nodeLane.name || nodeLane.id}) → ${sName}. Consider moving "${nName}" to lane "${predLane.name || predLane.id}".`,
    elementIds: [node.id],
    suggestion: `Use create_bpmn_lanes with assignments to move "${nName}" to lane "${predLane.name || predLane.id}".`,
  };
}

/** Check if a node has a zigzag pattern through a predecessor's lane. */
function findZigzag(node: any, nodeLane: any, laneMap: Map<string, any>): LaneIssue | null {
  for (const inFlow of node.incoming || []) {
    const pred = inFlow.sourceRef;
    if (!pred) continue;
    // Gateway-sourced cross-lane flows are structurally necessary for fork/join
    // patterns — they should never be reported as zigzags.
    const predType: string = pred.$type || pred.type || '';
    if (predType.includes('Gateway')) continue;
    const predLane = laneMap.get(pred.id);
    if (!predLane || predLane.id === nodeLane.id) continue;
    for (const outFlow of node.outgoing || []) {
      const succ = outFlow.targetRef;
      if (!succ) continue;
      const succLane = laneMap.get(succ.id);
      if (!succLane || succLane.id !== predLane.id) continue;
      return buildZigzagIssue(node, nodeLane, pred, predLane, succ, succLane);
    }
    break;
  }
  return null;
}

/** Count cross-lane flows that originate from gateways (intentional fork/join patterns). */
function countGatewayCrossings(flowNodes: any[], laneMap: Map<string, any>): number {
  let count = 0;
  for (const node of flowNodes) {
    const nodeLane = laneMap.get(node.id);
    if (!nodeLane) continue;
    for (const inFlow of node.incoming || []) {
      const pred = inFlow.sourceRef;
      if (!pred) continue;
      const predType: string = pred.$type || pred.type || '';
      if (!predType.includes('Gateway')) continue;
      const predLane = laneMap.get(pred.id);
      if (predLane && predLane.id !== nodeLane.id) count++;
    }
  }
  return count;
}

/** Detect zigzag flow patterns (A-lane → B-lane → A-lane). */
function checkZigzag(flowNodes: any[], laneMap: Map<string, any>, issues: LaneIssue[]): void {
  for (const node of flowNodes) {
    const nodeLane = laneMap.get(node.id);
    if (!nodeLane) {
      continue;
    }
    const issue = findZigzag(node, nodeLane, laneMap);
    if (issue) {
      issues.push(issue);
    }
  }
  const gatewayCrossings = countGatewayCrossings(flowNodes, laneMap);
  if (gatewayCrossings > 0) {
    issues.push({
      severity: 'info',
      code: 'gateway-cross-lane-flows',
      message:
        `${gatewayCrossings} cross-lane flow(s) originate from gateways — ` +
        `these are intentional fork/join patterns and are excluded from zigzag detection.`,
      elementIds: [],
      suggestion:
        'No action required. Gateway-sourced cross-lane flows are structurally necessary.',
    });
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleValidateLaneOrganization(
  args: ValidateLaneOrganizationArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);

  const diagram = requireDiagram(args.diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const canvas = getService(diagram.modeler, 'canvas');
  const process = findProcess(elementRegistry, canvas, args.participantId);

  if (!process) {
    return jsonResult({
      valid: false,
      issues: [{ severity: 'error', code: 'no-process', message: 'No process found in diagram' }],
    });
  }

  const flowElements: any[] = (process.flowElements as any[]) || [];
  const { flowNodes, sequenceFlows } = partitionFlowElements(flowElements);
  const laneSets = (process.laneSets as any[]) || [];
  const lanes = getAllLanes(laneSets);
  const laneMap = buildLaneMap(laneSets);

  if (lanes.length === 0) {
    return jsonResult({
      valid: true,
      totalLanes: 0,
      totalFlowNodes: flowNodes.length,
      issues: [
        {
          severity: 'info',
          code: 'no-lanes',
          message: `Process has ${flowNodes.length} flow node(s) but no lanes defined. Use analyze_bpmn_lanes (mode: suggest) to plan a lane structure.`,
          suggestion: 'analyze_bpmn_lanes (mode: suggest)',
        },
      ],
      coherenceScore: 100,
      crossLaneFlows: 0,
      intraLaneFlows: 0,
      laneDetails: [],
    });
  }

  const laneDetails = buildLaneDetails(lanes, flowElements);
  const issues: LaneIssue[] = [];

  checkLanePopulation(laneDetails, issues);
  checkUnassigned(flowNodes, laneMap, issues);
  const { coherence, crossLane, intraLane } = computeCoherence(sequenceFlows, laneMap);

  const total = intraLane + crossLane;
  if (total >= 4 && coherence < 50) {
    issues.push({
      severity: 'warning',
      code: 'low-coherence',
      message: `Lane coherence is only ${coherence}% (${crossLane} of ${total} flows cross lane boundaries). Consider reorganizing tasks.`,
      suggestion:
        'Use analyze_bpmn_lanes (mode: suggest) to get recommendations for better lane assignments.',
    });
  }

  checkZigzag(flowNodes, laneMap, issues);
  const valid = issues.filter((i) => i.severity === 'error').length === 0;

  return jsonResult({
    valid,
    totalLanes: lanes.length,
    totalFlowNodes: flowNodes.length,
    issues,
    coherenceScore: coherence,
    crossLaneFlows: crossLane,
    intraLaneFlows: intraLane,
    laneDetails,
  } satisfies ValidationResult);
}
// ══════════════════════════════════════════════════════════════════════
// pool-vs-lanes mode — was suggest-pool-vs-lanes.ts
// ══════════════════════════════════════════════════════════════════════
export interface SuggestPoolVsLanesArgs {
  diagramId: string;
}

/** Recommendation result. */
interface PoolVsLanesResult {
  recommendation: 'lanes' | 'collaboration' | 'mixed';
  confidence: 'high' | 'medium' | 'low';
  reasoning: string[];
  indicators: {
    sameOrganization: string[];
    separateOrganization: string[];
  };
  participantAnalysis: Array<{
    id: string;
    name: string;
    expanded: boolean;
    taskCount: number;
    hasRealTasks: boolean;
    roles: string[];
  }>;
  suggestion: string;
}

/** Task types that indicate a process has real work. */
const POOL_TASK_TYPES = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:CallActivity',
  'bpmn:SubProcess',
]);

/** Roles suggesting same-organization (case-insensitive partial matches). */
const SAME_ORG_ROLE_PATTERNS = [
  'manager',
  'supervisor',
  'team',
  'department',
  'agent',
  'clerk',
  'reviewer',
  'approver',
  'analyst',
  'coordinator',
  'specialist',
  'lead',
  'officer',
  'admin',
  'user',
  'employee',
  'staff',
  'customer',
  'client',
  'requester',
  'submitter',
];

/** Roles suggesting separate systems/organizations. */
const SEPARATE_ORG_PATTERNS = [
  'api',
  'service',
  'system',
  'external',
  'third-party',
  'thirdparty',
  'vendor',
  'supplier',
  'partner',
  'bank',
  'payment',
  'gateway',
  'erp',
  'crm',
  'integration',
  'webhook',
  'endpoint',
];

/** Check if a participant is expanded via DI. */
function isParticipantExpanded(participantBo: any, definitions: any): boolean {
  const diagrams = definitions?.diagrams;
  if (!diagrams) return true;
  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;
    for (const el of plane.planeElement) {
      if (el.$type === 'bpmndi:BPMNShape' && el.bpmnElement?.id === participantBo.id) {
        return el.isExpanded !== false;
      }
    }
  }
  return true;
}

/** Extract candidateGroups and assignees from a process. */
function extractPoolRoles(process: any): string[] {
  const roles = new Set<string>();
  const flowElements = process?.flowElements || [];
  for (const el of flowElements) {
    const assignee = el.$attrs?.['camunda:assignee'] ?? el.assignee;
    if (assignee && typeof assignee === 'string') {
      roles.add(assignee.trim());
    }
    const cg = el.$attrs?.['camunda:candidateGroups'] ?? el.candidateGroups;
    if (cg) {
      for (const g of String(cg).split(',')) {
        const trimmed = g.trim();
        if (trimmed) roles.add(trimmed);
      }
    }
  }
  return [...roles];
}

/** Count real tasks in a process. */
function countPoolTasks(process: any): number {
  const flowElements = process?.flowElements || [];
  return flowElements.filter((el: any) => POOL_TASK_TYPES.has(el.$type)).length;
}

/** Check if a name matches same-org patterns. */
function matchesSameOrgPattern(name: string): boolean {
  const lower = name.toLowerCase();
  return SAME_ORG_ROLE_PATTERNS.some((p) => lower.includes(p));
}

/** Check if a name matches separate-org patterns. */
function matchesSeparateOrgPattern(name: string): boolean {
  const lower = name.toLowerCase();
  return SEPARATE_ORG_PATTERNS.some((p) => lower.includes(p));
}

/** Find common prefix among strings. */
function findCommonPrefix(values: string[]): string {
  if (values.length < 2) return '';
  const sorted = [...values].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let i = 0;
  while (i < first.length && i < last.length && first[i] === last[i]) i++;
  return first.slice(0, i);
}

/** Analyze all expanded participants and build their analysis objects. */
function analyzeParticipants(
  participants: any[],
  definitions: any
): PoolVsLanesResult['participantAnalysis'] {
  return participants.map((p: any) => {
    const bo = p.businessObject;
    const expanded = isParticipantExpanded(bo, definitions);
    const process = bo.processRef;
    return {
      id: p.id,
      name: bo.name || p.id,
      expanded,
      taskCount: process ? countPoolTasks(process) : 0,
      hasRealTasks: process ? countPoolTasks(process) > 0 : false,
      roles: process ? extractPoolRoles(process) : [],
    };
  });
}

/** Collect same-org and separate-org indicators from pool names and roles. */
function collectPoolIndicators(
  expandedPools: PoolVsLanesResult['participantAnalysis'],
  messageFlows: any[]
): { sameOrg: string[]; separateOrg: string[] } {
  const sameOrg: string[] = [];
  const separateOrg: string[] = [];

  // Heuristic 1: Pool naming patterns
  for (const a of expandedPools) {
    if (matchesSameOrgPattern(a.name)) {
      sameOrg.push(`Pool "${a.name}" has a role-like name suggesting an organizational role`);
    }
    if (matchesSeparateOrgPattern(a.name)) {
      separateOrg.push(
        `Pool "${a.name}" has a system/external-like name suggesting a separate system`
      );
    }
  }

  // Heuristic 2: Shared namespace in candidateGroups
  const allRoles = expandedPools.flatMap((a) => a.roles);
  if (allRoles.length >= 2) {
    const prefix = findCommonPrefix(allRoles);
    if (prefix.length >= 3 || prefix.includes('.')) {
      sameOrg.push(
        `Shared candidateGroups namespace prefix: "${prefix}" — suggests same organization`
      );
    }
    const poolsWithRoles = expandedPools.filter((a) => a.roles.length > 0);
    if (poolsWithRoles.length >= 2) {
      sameOrg.push(
        `${poolsWithRoles.length} pools define candidateGroups — suggests role separation within one org`
      );
    }
  }

  // Heuristic 3: Empty/message-only pools
  const emptyPools = expandedPools.filter((a) => !a.hasRealTasks);
  if (emptyPools.length > 0) {
    separateOrg.push(
      `${emptyPools.length} expanded pool(s) have no real tasks (${emptyPools.map((p) => `"${p.name}"`).join(', ')}) — ` +
        'these should be collapsed to represent external endpoints'
    );
  }

  // Heuristic 4: All pools have real tasks
  if (expandedPools.every((a) => a.hasRealTasks) && expandedPools.length >= 2) {
    sameOrg.push(
      'All expanded pools have real tasks — suggests they model a single process with role separation'
    );
  }

  // Heuristic 5: Message flow analysis
  if (messageFlows.length > 0 && expandedPools.length >= 2) {
    const expandedIds = new Set(expandedPools.map((a) => a.id));
    const betweenExpanded = messageFlows.filter((mf: any) => {
      const srcPool = mf.source?.parent?.id;
      const tgtPool = mf.target?.parent?.id;
      return expandedIds.has(srcPool) && expandedIds.has(tgtPool);
    });
    if (betweenExpanded.length > 0) {
      sameOrg.push(
        `${betweenExpanded.length} message flow(s) between expanded pools — ` +
          'in-org communication is better modeled as sequence flows with lanes'
      );
    }
  }

  return { sameOrg, separateOrg };
}

/** Score indicators and produce a recommendation. */
function computePoolRecommendation(sameScore: number, sepScore: number) {
  const totalScore = sameScore + sepScore;
  let recommendation: PoolVsLanesResult['recommendation'];
  let confidence: PoolVsLanesResult['confidence'];
  const reasoning: string[] = [];

  if (totalScore === 0) {
    recommendation = 'lanes';
    confidence = 'low';
    reasoning.push(
      'No strong indicators found. Defaulting to lanes (simpler model). ' +
        'Use separate pools only when participants represent truly independent systems.'
    );
  } else if (sameScore > sepScore) {
    recommendation = 'lanes';
    confidence = sameScore >= 3 ? 'high' : 'medium';
    reasoning.push(
      `${sameScore} indicator(s) suggest same-organization roles vs ${sepScore} for separate systems.`
    );
    reasoning.push(
      'Consider converting to a single pool with lanes using create_bpmn_lanes (with mergeFrom).'
    );
  } else if (sepScore > sameScore) {
    recommendation = 'collaboration';
    confidence = sepScore >= 3 ? 'high' : 'medium';
    reasoning.push(
      `${sepScore} indicator(s) suggest separate systems vs ${sameScore} for same-organization.`
    );
    reasoning.push(
      'Keep the collaboration pattern. Consider collapsing non-executable pools ' +
        '(Camunda 7 supports only one executable pool).'
    );
  } else {
    recommendation = 'mixed';
    confidence = 'low';
    reasoning.push(
      `Equal indicators (${sameScore} each) — mixed signals. ` +
        'Review the process semantics to decide.'
    );
  }

  return { recommendation, confidence, reasoning };
}

export async function handleSuggestPoolVsLanes(args: SuggestPoolVsLanesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);

  const diagram = requireDiagram(args.diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const canvas = getService(diagram.modeler, 'canvas');

  const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');

  if (participants.length < 2) {
    return jsonResult({
      recommendation: 'lanes',
      confidence: 'high',
      reasoning: ['Only one pool exists — no collaboration to evaluate.'],
      suggestion:
        'Use create_bpmn_lanes to add lanes for role separation within the existing pool.',
    });
  }

  const rootBo = canvas.getRootElement()?.businessObject;
  const definitions = rootBo?.$parent ?? rootBo;
  const analysis = analyzeParticipants(participants, definitions);
  const expandedPools = analysis.filter((a) => a.expanded);

  const messageFlows = elementRegistry.filter((el: any) => el.type === 'bpmn:MessageFlow');
  const { sameOrg, separateOrg } = collectPoolIndicators(expandedPools, messageFlows);
  const { recommendation, confidence, reasoning } = computePoolRecommendation(
    sameOrg.length,
    separateOrg.length
  );

  const suggestion =
    recommendation === 'lanes'
      ? 'Use create_bpmn_lanes (with mergeFrom) to merge pools into a single pool with lanes.'
      : recommendation === 'collaboration'
        ? 'Keep the collaboration structure. Ensure non-executable pools are collapsed (Camunda 7 pattern).'
        : 'Review manually. Consider which participants represent external systems (→ collapsed pools) ' +
          'vs internal roles (→ lanes).';

  return jsonResult({
    recommendation,
    confidence,
    reasoning,
    indicators: {
      sameOrganization: sameOrg,
      separateOrganization: separateOrg,
    },
    participantAnalysis: analysis,
    suggestion,
  } satisfies PoolVsLanesResult);
}
// ══════════════════════════════════════════════════════════════════════
// Main dispatcher
// ══════════════════════════════════════════════════════════════════════
export async function handleAnalyzeLanes(args: AnalyzeLanesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'mode']);

  switch (args.mode) {
    case 'suggest':
      return handleSuggestLaneOrganization({
        diagramId: args.diagramId,
        participantId: args.participantId,
      });
    case 'validate':
      return handleValidateLaneOrganization({
        diagramId: args.diagramId,
        participantId: args.participantId,
      });
    case 'pool-vs-lanes':
      return handleSuggestPoolVsLanes({
        diagramId: args.diagramId,
      });
    default:
      return handleSuggestLaneOrganization({
        diagramId: args.diagramId,
        participantId: args.participantId,
      });
  }
}

export const TOOL_DEFINITION = {
  name: 'analyze_bpmn_lanes',
  description:
    'Analyze lane organization in a BPMN diagram. Three modes: ' +
    "'suggest' — analyze tasks and suggest optimal lane assignments based on roles (camunda:assignee/candidateGroups) " +
    'or element types (human vs automated). Returns structured suggestions with lane names, coherence score, and reasoning. ' +
    "'validate' — check if current lane assignment makes semantic sense by analyzing cross-lane flow frequency, " +
    'zigzag patterns, single-element lanes, and overall coherence. Returns structured issues with fix suggestions. ' +
    "'pool-vs-lanes' — evaluate whether a collaboration should use separate pools (different organizations/systems) " +
    'or lanes (role separation within one organization). Returns recommendation with confidence and reasoning. ' +
    'Read-only; to assign or redistribute elements use create_bpmn_lanes.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
      mode: {
        type: 'string',
        enum: ['suggest', 'validate', 'pool-vs-lanes'],
        description:
          "Analysis mode: 'suggest' for lane assignment recommendations, " +
          "'validate' for checking current lane organization quality, " +
          "'pool-vs-lanes' for deciding between pools and lanes.",
      },
      participantId: {
        type: 'string',
        description:
          "Optional participant ID to scope the analysis (used with 'suggest' and 'validate' modes).",
      },
    },
    required: ['diagramId', 'mode'],
  },
} as const;
