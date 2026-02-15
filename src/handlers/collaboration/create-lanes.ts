/**
 * Handler for create_bpmn_lanes tool.
 *
 * Creates a bpmn:LaneSet with multiple bpmn:Lane elements inside a
 * participant pool.  Each lane gets proper DI bounds and is sized to
 * divide the pool height evenly (or as specified).
 *
 * When distributeStrategy is set, automatically splits existing elements
 * into the created lanes (merged from split_bpmn_participant_into_lanes).
 */
// @mutating

import { type ToolResult } from '../../types';
import { missingRequiredError, typeMismatchError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';
import { autoDistributeElements, type AutoDistributeResult } from './auto-distribute';
import { calculateOptimalPoolSize } from '../../constants';
import { handleAssignElementsToLane } from './assign-elements-to-lane';
import {
  getChildFlowElements,
  buildByTypeLaneDefs,
  buildCreateLanesNextSteps,
} from './by-type-distribution';

export interface CreateLanesArgs {
  diagramId: string;
  /** The participant (pool) to add lanes to. */
  participantId: string;
  /** Lane definitions — at least 2 lanes required (unless distributeStrategy generates them). */
  lanes?: Array<{
    name: string;
    /** Optional explicit height (px). If omitted, pool height is divided evenly. */
    height?: number;
    /** For 'manual' distributeStrategy: element IDs to assign to this lane. */
    elementIds?: string[];
  }>;
  /**
   * When true, automatically assigns existing elements in the participant to the
   * created lanes based on matching lane names to element roles (camunda:assignee
   * or camunda:candidateGroups). Elements without role matches fall back to
   * type-based grouping (human tasks vs automated tasks).
   */
  autoDistribute?: boolean;
  /**
   * When set, automatically splits existing elements into the created lanes.
   * - 'by-type': categorize by BPMN type (UserTask → "Human Tasks", ServiceTask → "Automated Tasks").
   *   Lanes param is auto-generated from element types.
   * - 'manual': use explicit elementIds in each lane definition.
   */
  distributeStrategy?: 'by-type' | 'manual';
}

/** Minimum lane height in pixels. */
const MIN_LANE_HEIGHT = 80;

/** Lane header offset in pixels (left side of pool). */
const LANE_HEADER_OFFSET = 30;

interface LaneGeometry {
  laneX: number;
  laneWidth: number;
  autoHeight: number;
  totalLaneHeight: number;
}

/** Compute lane geometry from pool dimensions and lane definitions. */
function computeLaneGeometry(
  poolX: number,
  poolWidth: number,
  poolHeight: number,
  lanes: NonNullable<CreateLanesArgs['lanes']>
): LaneGeometry {
  const laneX = poolX + LANE_HEADER_OFFSET;
  const laneWidth = poolWidth - LANE_HEADER_OFFSET;
  const totalExplicit = lanes.reduce((sum, l) => sum + (l.height || 0), 0);
  const autoLanes = lanes.filter((l) => !l.height).length;
  const autoHeight =
    autoLanes > 0
      ? Math.max(MIN_LANE_HEIGHT, Math.floor((poolHeight - totalExplicit) / autoLanes))
      : 0;
  const totalLaneHeight = lanes.reduce((sum, l) => sum + (l.height || autoHeight), 0);
  return { laneX, laneWidth, autoHeight, totalLaneHeight };
}

/** Create a single lane shape within a participant. */
function createSingleLane(
  diagram: any,
  participant: any,
  laneDef: { name: string; height?: number },
  geometry: LaneGeometry,
  currentY: number
): string {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementFactory = getService(diagram.modeler, 'elementFactory');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const laneHeight = laneDef.height || geometry.autoHeight;
  const laneId = generateDescriptiveId(elementRegistry, 'bpmn:Lane', laneDef.name);
  const shape = elementFactory.createShape({ type: 'bpmn:Lane', id: laneId });
  shape.width = geometry.laneWidth;
  shape.height = laneHeight;

  const laneCenterX = geometry.laneX + geometry.laneWidth / 2;
  const laneCenterY = currentY + laneHeight / 2;
  modeling.createShape(shape, { x: laneCenterX, y: laneCenterY }, participant);
  modeling.updateProperties(shape, { name: laneDef.name });

  const created = elementRegistry.get(shape.id) || shape;
  modeling.resizeShape(created, {
    x: geometry.laneX,
    y: currentY,
    width: geometry.laneWidth,
    height: laneHeight,
  });

  return created.id;
}

// ── Strategy resolution ────────────────────────────────────────────────────

interface StrategyResult {
  lanes: NonNullable<CreateLanesArgs['lanes']>;
  distributeAssignments?: Array<{ name: string; elementIds: string[] }>;
}

function resolveDistributeStrategy(
  args: CreateLanesArgs,
  elementRegistry: any
): StrategyResult | ToolResult {
  const { distributeStrategy, participantId } = args;
  let lanes = args.lanes;
  let distributeAssignments: Array<{ name: string; elementIds: string[] }> | undefined;

  if (distributeStrategy === 'by-type') {
    const childElements = getChildFlowElements(elementRegistry, participantId);
    if (childElements.length === 0) {
      return jsonResult({
        success: false,
        message: `Participant "${participantId}" has no elements to distribute into lanes.`,
      });
    }
    const generated = buildByTypeLaneDefs(childElements, elementRegistry);
    lanes = generated;
    distributeAssignments = generated;
  } else if (distributeStrategy === 'manual') {
    if (!lanes || lanes.length < 2) {
      throw missingRequiredError([
        'lanes (at least 2 required for manual distributeStrategy, each with elementIds)',
      ]);
    }
    for (const l of lanes) {
      if (!l.elementIds || l.elementIds.length === 0) {
        throw missingRequiredError([`elementIds in lane "${l.name}"`]);
      }
    }
    distributeAssignments = lanes as Array<{ name: string; elementIds: string[] }>;
  }

  if (!lanes || lanes.length < 2) {
    throw missingRequiredError(['lanes (at least 2 lanes required)']);
  }
  return { lanes, distributeAssignments };
}

function isEarlyReturn(result: StrategyResult | ToolResult): result is ToolResult {
  return 'content' in result;
}

// ── Pool resizing & lane creation ──────────────────────────────────────────

function resizePoolIfNeeded(
  modeling: any,
  participant: any,
  lanes: NonNullable<CreateLanesArgs['lanes']>,
  geometry: LaneGeometry
): void {
  const poolHeight = participant.height || 250;
  const optimalSize = calculateOptimalPoolSize(0, lanes.length);
  const effectivePoolHeight = Math.max(poolHeight, optimalSize.height);
  if (effectivePoolHeight > poolHeight || geometry.totalLaneHeight > poolHeight) {
    modeling.resizeShape(participant, {
      x: participant.x,
      y: participant.y,
      width: participant.width || 600,
      height: Math.max(effectivePoolHeight, geometry.totalLaneHeight),
    });
  }
}

function createAllLanes(
  diagram: any,
  participant: any,
  lanes: NonNullable<CreateLanesArgs['lanes']>,
  geometry: LaneGeometry
): string[] {
  const createdIds: string[] = [];
  let currentY = participant.y;
  for (const laneDef of lanes) {
    createdIds.push(createSingleLane(diagram, participant, laneDef, geometry, currentY));
    currentY += laneDef.height || geometry.autoHeight;
  }
  return createdIds;
}

// ── Strategy assignment execution ──────────────────────────────────────────

async function executeStrategyAssignments(
  distributeAssignments: Array<{ name: string; elementIds: string[] }>,
  createdIds: string[],
  diagramId: string
): Promise<Record<string, string[]>> {
  const assignments: Record<string, string[]> = {};
  for (let i = 0; i < Math.min(distributeAssignments.length, createdIds.length); i++) {
    const da = distributeAssignments[i];
    if (da.elementIds && da.elementIds.length > 0) {
      await handleAssignElementsToLane({
        diagramId,
        laneId: createdIds[i],
        elementIds: da.elementIds,
        reposition: true,
      });
      assignments[createdIds[i]] = da.elementIds;
    }
  }
  return assignments;
}

// ── Result building ────────────────────────────────────────────────────────

function buildCreateLanesResult(
  participantId: string,
  createdIds: string[],
  lanes: NonNullable<CreateLanesArgs['lanes']>,
  distributeStrategy: string | undefined,
  strategyAssignments: Record<string, string[]>,
  distributeResult: AutoDistributeResult | undefined
): ToolResult {
  let message = `Created ${createdIds.length} lanes in participant ${participantId}: ${createdIds.join(', ')}`;
  if (distributeResult && distributeResult.assignedCount > 0) {
    message += ` (auto-distributed ${distributeResult.assignedCount} element(s))`;
  }
  if (distributeStrategy && Object.keys(strategyAssignments).length > 0) {
    const totalAssigned = Object.values(strategyAssignments).reduce(
      (sum, ids) => sum + ids.length,
      0
    );
    message += ` (${distributeStrategy} strategy: assigned ${totalAssigned} element(s))`;
  }

  const resultData: Record<string, any> = {
    success: true,
    participantId,
    laneIds: createdIds,
    laneCount: createdIds.length,
    laneNames: lanes.map((l) => l.name),
    message,
    ...(distributeStrategy ? { strategy: distributeStrategy } : {}),
    ...(Object.keys(strategyAssignments).length > 0 ? { assignments: strategyAssignments } : {}),
  };

  if (distributeResult) {
    resultData.autoDistribute = {
      assignedCount: distributeResult.assignedCount,
      assignments: distributeResult.assignments,
      ...(distributeResult.unassigned.length > 0
        ? { unassigned: distributeResult.unassigned }
        : {}),
    };
  }

  resultData.nextSteps = buildCreateLanesNextSteps(distributeResult?.assignedCount);
  return jsonResult(resultData);
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleCreateLanes(args: CreateLanesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'participantId']);
  const { diagramId, participantId, autoDistribute = false, distributeStrategy } = args;

  const diagram = requireDiagram(diagramId);
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const participant = requireElement(elementRegistry, participantId);
  if (participant.type !== 'bpmn:Participant') {
    throw typeMismatchError(participantId, participant.type, ['bpmn:Participant']);
  }

  // Check for existing lanes — reject if participant already has lanes (idempotency guard)
  const existingLanes = elementRegistry.filter(
    (el: any) => el.type === 'bpmn:Lane' && el.parent?.id === participantId
  );
  if (existingLanes.length > 0) {
    const existingNames = existingLanes.map((l: any) => l.businessObject?.name || l.id).join(', ');
    throw new Error(
      `Participant "${participantId}" already has ${existingLanes.length} lane(s): ${existingNames}. ` +
        'Use assign_bpmn_elements_to_lane to modify lane assignments, or delete existing lanes first.'
    );
  }

  // Resolve strategy and lanes
  const resolved = resolveDistributeStrategy(args, elementRegistry);
  if (isEarlyReturn(resolved)) return resolved;
  const { lanes, distributeAssignments } = resolved;

  const poolWidth = participant.width || 600;
  const poolHeight = participant.height || 250;
  const optimalSize = calculateOptimalPoolSize(0, lanes.length);
  const effectivePoolHeight = Math.max(poolHeight, optimalSize.height);
  const geometry = computeLaneGeometry(participant.x, poolWidth, effectivePoolHeight, lanes);

  resizePoolIfNeeded(modeling, participant, lanes, geometry);
  const createdIds = createAllLanes(diagram, participant, lanes, geometry);

  // Auto-distribute existing elements to lanes if requested
  const distributeResult = autoDistribute
    ? autoDistributeElements(
        diagram,
        participant,
        createdIds,
        lanes.map((l) => l.name)
      )
    : undefined;

  // Execute strategy assignments
  const strategyAssignments = distributeAssignments
    ? await executeStrategyAssignments(distributeAssignments, createdIds, diagramId)
    : {};

  await syncXml(diagram);

  const result = buildCreateLanesResult(
    participantId,
    createdIds,
    lanes,
    distributeStrategy,
    strategyAssignments,
    distributeResult
  );
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'create_bpmn_lanes',
  description:
    'Create lanes (swimlanes) within a participant pool. Creates a bpmn:LaneSet with ' +
    'the specified lanes, dividing the pool height evenly (or using explicit heights). ' +
    'Lanes represent roles or departments within a single organization/process. ' +
    'Use lanes for role separation within one pool; use separate pools (participants) ' +
    'for separate organizations with message flows. Requires at least 2 lanes when ' +
    'defined manually. Alternatively, use distributeStrategy to auto-generate lanes: ' +
    '"by-type" groups elements into Human Tasks vs Automated Tasks lanes; "manual" uses ' +
    'elementIds in each lane definition to assign elements explicitly.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      participantId: {
        type: 'string',
        description: 'The ID of the participant (pool) to add lanes to',
      },
      lanes: {
        type: 'array',
        description:
          'Lane definitions (at least 2). Optional when distributeStrategy is "by-type" ' +
          '(lanes are auto-generated from element types).',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Lane name (typically a role or department)' },
            height: {
              type: 'number',
              description:
                'Optional lane height in pixels. If omitted, the pool height is divided evenly among lanes without explicit heights.',
            },
            elementIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Element IDs to assign to this lane (used with distributeStrategy "manual").',
            },
          },
          required: ['name'],
        },
        minItems: 2,
      },
      autoDistribute: {
        type: 'boolean',
        description:
          'When true, automatically assigns existing elements in the participant to the ' +
          'created lanes based on matching lane names to element roles (camunda:assignee ' +
          'or camunda:candidateGroups, case-insensitive). Elements without role matches ' +
          'fall back to type-based grouping (human tasks vs automated tasks). ' +
          'Flow-control elements (gateways, events) are assigned to their most-connected ' +
          "neighbor's lane. Run layout_bpmn_diagram afterwards for clean positioning.",
      },
      distributeStrategy: {
        type: 'string',
        enum: ['by-type', 'manual'],
        description:
          'Auto-generate and distribute elements to lanes. "by-type": auto-creates lanes ' +
          'based on element types (Human Tasks, Automated Tasks). "manual": uses elementIds ' +
          'in each lane definition to assign elements. When omitted, lanes are created without distribution.',
      },
    },
    required: ['diagramId', 'participantId'],
  },
} as const;
