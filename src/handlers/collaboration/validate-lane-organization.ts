/**
 * Handler for validate_bpmn_lane_organization tool.
 *
 * Checks if the current lane assignment makes semantic sense by analyzing
 * cross-lane flow frequency, zigzag patterns, single-element lanes, and
 * overall coherence. Returns structured issues with fix suggestions.
 */

import { type ToolResult } from '../../types';
import { requireDiagram, jsonResult, validateArgs } from '../helpers';
import { getService } from '../../bpmn-types';

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
function findProcess(elementRegistry: any, canvas: any, participantId?: string): any | null {
  if (participantId) {
    const p = elementRegistry.get(participantId);
    if (p?.businessObject?.processRef) return p.businessObject.processRef;
  }
  const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
  if (participants.length > 0) return participants[0].businessObject?.processRef;
  return canvas.getRootElement()?.businessObject ?? null;
}

/** Filter flow elements into flow nodes (non-flow) and sequence flows. */
function partitionFlowElements(flowElements: any[]): { flowNodes: any[]; sequenceFlows: any[] } {
  const flowNodes = flowElements.filter(
    (el: any) =>
      el.$type !== 'bpmn:SequenceFlow' &&
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
    const typeCount: Record<string, number> = {};
    for (const ref of refs) {
      const refObj = typeof ref === 'string' ? flowElements.find((e: any) => e.id === ref) : ref;
      if (refObj) {
        const t = refObj.$type || 'unknown';
        typeCount[t] = (typeCount[t] || 0) + 1;
      }
    }
    return {
      laneId: lane.id,
      laneName: lane.name || lane.id,
      elementCount: refs.length,
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
          'Use delete_bpmn_element to remove the empty lane, or assign_bpmn_elements_to_lane to populate it.',
      });
    } else if (detail.elementCount <= 1) {
      issues.push({
        severity: 'info',
        code: 'lane-single-element',
        message: `Lane "${detail.laneName}" contains only ${detail.elementCount} element(s). Consider merging with another lane.`,
        elementIds: [detail.laneId],
        suggestion:
          "Consider using assign_bpmn_elements_to_lane to merge this lane's elements into a related lane.",
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
      suggestion: 'Use assign_bpmn_elements_to_lane to assign these elements to appropriate lanes.',
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

/** Check if a node has a zigzag pattern through a predecessor's lane. */
function findZigzag(node: any, nodeLane: any, laneMap: Map<string, any>): LaneIssue | null {
  for (const inFlow of node.incoming || []) {
    const pred = inFlow.sourceRef;
    if (!pred) {
      continue;
    }
    const predLane = laneMap.get(pred.id);
    if (!predLane || predLane.id === nodeLane.id) {
      continue;
    }
    for (const outFlow of node.outgoing || []) {
      const succ = outFlow.targetRef;
      if (!succ) {
        continue;
      }
      const succLane = laneMap.get(succ.id);
      if (!succLane || succLane.id !== predLane.id) {
        continue;
      }
      const nName = node.name || node.id;
      const pName = `${pred.name || pred.id} (${predLane.name || predLane.id})`;
      const sName = `${succ.name || succ.id} (${succLane.name || succLane.id})`;
      return {
        severity: 'warning',
        code: 'zigzag-flow',
        message: `Zigzag flow: ${pName} → ${nName} (${nodeLane.name || nodeLane.id}) → ${sName}. Consider moving "${nName}" to lane "${predLane.name || predLane.id}".`,
        elementIds: [node.id],
        suggestion: `Use assign_bpmn_elements_to_lane to move "${nName}" to lane "${predLane.name || predLane.id}".`,
      };
    }
    break;
  }
  return null;
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

  const flowElements: any[] = process.flowElements || [];
  const { flowNodes, sequenceFlows } = partitionFlowElements(flowElements);
  const laneSets = process.laneSets || [];
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
          message: `Process has ${flowNodes.length} flow node(s) but no lanes defined. Use suggest_bpmn_lane_organization to plan a lane structure.`,
          suggestion: 'suggest_bpmn_lane_organization',
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
        'Use suggest_bpmn_lane_organization to get recommendations for better lane assignments.',
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

// ── Tool definition ────────────────────────────────────────────────────────

export const TOOL_DEFINITION = {
  name: 'validate_bpmn_lane_organization',
  description:
    'Validate the current lane organization of a BPMN process. Checks for empty lanes, ' +
    'single-element lanes, unassigned elements, excessive cross-lane flows, and zigzag patterns. ' +
    'Returns a coherence score and structured issues with fix suggestions. ' +
    'Use this after creating or modifying lanes to verify the organization quality.',
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
          'Optional participant ID to scope the validation. When omitted, uses the first process.',
      },
    },
    required: ['diagramId'],
  },
} as const;
