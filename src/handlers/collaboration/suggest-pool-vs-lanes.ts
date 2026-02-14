/**
 * Handler for suggest_bpmn_pool_vs_lanes tool.
 *
 * Read-only analysis tool that evaluates whether a workflow should use
 * a collaboration (separate pools for separate organizations/systems)
 * or lanes (role separation within a single organization).
 *
 * Heuristics:
 * - Shared namespace patterns in candidateGroups across pools
 * - Same assignee patterns
 * - Presence of real tasks vs message-only pools
 * - Message flow patterns (fire-and-forget vs bidirectional)
 * - Pool naming patterns suggesting same-org roles
 */

import { type ToolResult } from '../../types';
import { requireDiagram, jsonResult, validateArgs } from '../helpers';
import { getService } from '../../bpmn-types';

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
const TASK_TYPES = new Set([
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
function isExpanded(participantBo: any, definitions: any): boolean {
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
function extractRoles(process: any): string[] {
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
function countTasks(process: any): number {
  const flowElements = process?.flowElements || [];
  return flowElements.filter((el: any) => TASK_TYPES.has(el.$type)).length;
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
    const expanded = isExpanded(bo, definitions);
    const process = bo.processRef;
    return {
      id: p.id,
      name: bo.name || p.id,
      expanded,
      taskCount: process ? countTasks(process) : 0,
      hasRealTasks: process ? countTasks(process) > 0 : false,
      roles: process ? extractRoles(process) : [],
    };
  });
}

/** Collect same-org and separate-org indicators from pool names and roles. */
function collectIndicators(
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
function computeRecommendation(sameScore: number, sepScore: number) {
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
      'Consider converting to a single pool with lanes using convert_bpmn_collaboration_to_lanes.'
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
  const { sameOrg, separateOrg } = collectIndicators(expandedPools, messageFlows);
  const { recommendation, confidence, reasoning } = computeRecommendation(
    sameOrg.length,
    separateOrg.length
  );

  const suggestion =
    recommendation === 'lanes'
      ? 'Use convert_bpmn_collaboration_to_lanes to merge pools into a single pool with lanes.'
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

// ── Tool definition ──────────────────────────────────────────────────────

export const TOOL_DEFINITION = {
  name: 'suggest_bpmn_pool_vs_lanes',
  description:
    'Analyze a collaboration diagram to determine whether it should use ' +
    'separate pools (for different organizations/systems) or lanes within a single pool ' +
    '(for role separation within one organization). Returns a recommendation with ' +
    'confidence level, detailed reasoning, and actionable suggestions. ' +
    'Uses heuristics: naming patterns, candidateGroups namespace analysis, ' +
    'task distribution, and message flow patterns.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
    },
    required: ['diagramId'],
  },
} as const;
