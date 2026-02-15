/**
 * Handler for optimize_bpmn_lane_assignments tool.
 *
 * Combines validation + redistribution into a single operation:
 * 1. Runs lane validation to detect issues (zigzags, low coherence, etc.)
 * 2. If fixable issues exist, automatically redistributes elements
 *    using the `minimize-crossings` strategy.
 * 3. Reports before/after metrics so the caller can see the improvement.
 */
// @mutating

import { type ToolResult } from '../../types';
import { requireDiagram, jsonResult, validateArgs, syncXml } from '../helpers';
import { getService } from '../../bpmn-types';
import { appendLintFeedback } from '../../linter';
import { handleValidateLaneOrganization } from './validate-lane-organization';
import { handleRedistributeElementsAcrossLanes } from './redistribute-elements-across-lanes';

export interface OptimizeLaneAssignmentsArgs {
  diagramId: string;
  /** Optional participant ID. When omitted, auto-detects the first participant with lanes. */
  participantId?: string;
  /**
   * Redistribution strategy when optimization is needed.
   * - 'minimize-crossings': minimizes cross-lane sequence flows (default)
   * - 'role-based': matches assignee/candidateGroups to lane names
   * - 'balance': spreads elements evenly while respecting roles
   */
  strategy?: 'minimize-crossings' | 'role-based' | 'balance';
  /** When true, returns the optimization plan without applying changes. */
  dryRun?: boolean;
  /** When true, repositions elements vertically into their new lane bounds (default: true). */
  reposition?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Find the first participant that has at least 2 lanes. */
function findParticipantWithLanes(elementRegistry: any): string | null {
  const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
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

/** Build the result JSON for a successful optimization. */
function buildOptimizedResult(
  dryRun: boolean,
  strategy: string,
  participantId: string,
  redistributeData: any,
  beforeData: any,
  afterData: any | null
): any {
  return {
    success: true,
    optimized: true,
    dryRun,
    strategy,
    participantId,
    movedCount: redistributeData.movedCount,
    totalElements: redistributeData.totalElements,
    moves: redistributeData.moves,
    before: coherenceMetrics(beforeData),
    ...(afterData
      ? {
          after: coherenceMetrics(afterData),
          improvement: afterData.coherenceScore - beforeData.coherenceScore,
        }
      : {}),
    message: dryRun
      ? `Dry run: would move ${redistributeData.movedCount} element(s) to improve lane assignments.`
      : `Optimized lane assignments: moved ${redistributeData.movedCount} element(s). ` +
        `Coherence: ${beforeData.coherenceScore}% → ${afterData?.coherenceScore ?? '?'}%.`,
    nextSteps: dryRun
      ? [
          {
            tool: 'optimize_bpmn_lane_assignments',
            description: 'Run again without dryRun to apply the changes.',
          },
        ]
      : [
          {
            tool: 'layout_bpmn_diagram',
            description: 'Re-layout diagram after lane optimization for clean visual positioning.',
          },
        ],
  };
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleOptimizeLaneAssignments(
  args: OptimizeLaneAssignmentsArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId, strategy = 'minimize-crossings', dryRun = false, reposition = true } = args;

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const participantId = args.participantId || findParticipantWithLanes(elementRegistry);
  if (!participantId) {
    return jsonResult({
      success: false,
      message:
        'No participant with at least 2 lanes found. ' +
        'Use create_bpmn_lanes to add lanes first, or specify participantId explicitly.',
    });
  }

  // Step 1: Validate current lane organization
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

  // Step 2: Redistribute elements
  const redistributeData = parseToolResult(
    await handleRedistributeElementsAcrossLanes({
      diagramId,
      participantId,
      strategy,
      reposition,
      dryRun,
    })
  );

  if (redistributeData.movedCount === 0) {
    return jsonResult({
      success: true,
      optimized: false,
      message: `No elements could be moved to improve lane assignments (coherence: ${beforeData.coherenceScore}%).`,
      ...coherenceMetrics(beforeData),
      issues: fixableIssues,
    });
  }

  // Step 3: Validate after optimization (only if we actually applied changes)
  let afterData: any = null;
  if (!dryRun) {
    await syncXml(diagram);
    afterData = parseToolResult(await handleValidateLaneOrganization({ diagramId, participantId }));
  }

  const result = jsonResult(
    buildOptimizedResult(dryRun, strategy, participantId, redistributeData, beforeData, afterData)
  );
  return dryRun ? result : appendLintFeedback(result, diagram);
}

// ── Tool definition (deprecated — subsumed by redistribute_bpmn_elements_across_lanes) ──

/** @deprecated Not registered as an MCP tool. */
const _UNUSED_TOOL_DEFINITION = {
  name: 'optimize_bpmn_lane_assignments',
  description:
    'Automatically optimize element assignments across lanes to minimize cross-lane flows ' +
    'and resolve common issues (zigzag patterns, low coherence). Combines validation and ' +
    'redistribution into a single operation. Returns before/after metrics showing the improvement. ' +
    'Use after creating a lane-based process when the initial assignment is suboptimal.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      participantId: {
        type: 'string',
        description:
          'The ID of the participant (pool) to optimize. When omitted, auto-detects the first participant with at least 2 lanes.',
      },
      strategy: {
        type: 'string',
        enum: ['minimize-crossings', 'role-based', 'balance'],
        description:
          "Redistribution strategy: 'minimize-crossings' (default) minimizes cross-lane flows; " +
          "'role-based' matches assignee/candidateGroups to lane names; " +
          "'balance' spreads elements evenly while respecting roles.",
      },
      dryRun: {
        type: 'boolean',
        description:
          'When true, returns the optimization plan without applying changes. Default: false.',
      },
      reposition: {
        type: 'boolean',
        description:
          'When true (default), repositions elements vertically into their new lane bounds after reassignment.',
      },
    },
    required: ['diagramId'],
  },
} as const;
