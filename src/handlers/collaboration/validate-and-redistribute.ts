/**
 * Validate-and-redistribute helpers.
 *
 * Extracted from redistribute-elements-across-lanes.ts to stay within
 * file-length lint limits. Implements the "optimize" flow that was
 * previously the separate optimize_bpmn_lane_assignments tool.
 */

import { type ToolResult } from '../../types';
import { jsonResult, syncXml } from '../helpers';
import { handleValidateLaneOrganization } from './validate-lane-organization';

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
              tool: 'validate_bpmn_lane_organization',
              description: 'Check if the new lane organization is coherent',
            },
          ]
        : [],
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Find the first participant that has at least 2 lanes. */
export function findParticipantWithLanes(elementRegistry: any): string | null {
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
            tool: 'redistribute_bpmn_elements_across_lanes',
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
