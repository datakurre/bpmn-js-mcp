/**
 * Handler for suggest_bpmn_lane_organization tool.
 *
 * Analyzes all flow nodes in a process and suggests optimal lane assignments
 * based on element types (human vs automated), sequential dependencies, and
 * connectivity patterns. Returns a structured suggestion with lane names,
 * assigned elements, and reasoning.
 */

import { type ToolResult } from '../../types';
import { requireDiagram, jsonResult, validateArgs } from '../helpers';
import { getService } from '../../bpmn-types';

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

/** Check if a flow node type is a gateway or event (flow control elements). */
function isFlowControl(type: string): boolean {
  return type.includes('Gateway') || type.includes('Event') || type === 'bpmn:Task';
}

/** Categorize a flow node by its BPMN type. Returns category name or null. */
function categorizeElement(type: string): string | null {
  for (const cat of TASK_CATEGORIES) {
    if ((cat.types as readonly string[]).includes(type)) return cat.name;
  }
  return null;
}

/** Find the process business object from the diagram. */
function findProcess(elementRegistry: any, canvas: any, participantId?: string): any | null {
  if (participantId) {
    const p = elementRegistry.get(participantId);
    if (p?.businessObject?.processRef) return p.businessObject.processRef;
  }
  const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
  if (participants.length > 0) return participants[0].businessObject?.processRef;
  return canvas.getRootElement()?.businessObject ?? null;
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
function countLaneVotes(el: any, laneMap: Map<string, string>): Map<string, number> {
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
function pickBestLane(votes: Map<string, number>): string | null {
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
function assignFlowControlToLanes(flowElements: any[], laneMap: Map<string, string>): void {
  const controls = flowElements.filter((el: any) => isFlowControl(el.$type) && !laneMap.has(el.id));
  for (let pass = 0; pass < 3; pass++) {
    for (const el of controls) {
      if (laneMap.has(el.id)) {
        continue;
      }
      const best = pickBestLane(countLaneVotes(el, laneMap));
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
    } else if (!isFlowControl(node.$type)) {
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
    if (!isFlowControl(node.$type) || !laneMap.has(node.id)) continue;
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
    return `Suggested organization achieves ${stats}. This is a good lane structure. Use create_bpmn_lanes and assign_bpmn_elements_to_lane to apply.`;
  }
  return `Suggested organization achieves ${stats}. Consider organizing by business role (e.g. "Requester", "Approver", "System") rather than task type for better flow coherence.`;
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
    (el: any) => !el.$type.includes('SequenceFlow') && !CONNECTION_TYPES.has(el.$type)
  );
  const sequenceFlows = flowElements.filter((el: any) => el.$type === 'bpmn:SequenceFlow');

  const laneMap = new Map<string, string>();
  const suggestions = buildCategorySuggestions(flowNodes, laneMap);
  assignFlowControlToLanes(flowNodes, laneMap);
  appendFlowControlToSuggestions(flowNodes, laneMap, suggestions);

  const { coherence, crossLane, intraLane } = calculateCoherence(sequenceFlows, laneMap);
  const recommendation = buildRecommendation(suggestions.length, coherence, intraLane, crossLane);

  // Collect current lane info (if any)
  const currentLanes: { name: string; elementCount: number }[] = [];
  for (const ls of process.laneSets || []) {
    for (const lane of ls.lanes || []) {
      currentLanes.push({
        name: lane.name || lane.id,
        elementCount: (lane.flowNodeRef || []).length,
      });
    }
  }

  const result: Record<string, any> = {
    totalFlowNodes: flowNodes.length,
    suggestions,
    crossLaneFlows: crossLane,
    intraLaneFlows: intraLane,
    coherenceScore: coherence,
    recommendation,
  };
  if (currentLanes.length > 0) result.currentLanes = currentLanes;
  return jsonResult(result);
}

// ── Tool definition ────────────────────────────────────────────────────────

export const TOOL_DEFINITION = {
  name: 'suggest_bpmn_lane_organization',
  description:
    'Analyze tasks in a BPMN process and suggest optimal lane assignments based on element types ' +
    '(human vs automated), sequential dependencies, and connectivity patterns. Returns structured ' +
    'suggestions with lane names, assigned elements, coherence score, and reasoning. ' +
    'Use this before creating lanes to plan a clean lane structure.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
      participantId: {
        type: 'string',
        description:
          'Optional participant ID to scope the analysis. When omitted, uses the first process.',
      },
    },
    required: ['diagramId'],
  },
} as const;
