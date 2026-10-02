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
import { missingRequiredError, typeMismatchError, illegalCombinationError } from '../../errors';
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
import {
  autoDistributeElements,
  handleRedistributeElementsAcrossLanes,
  findEmptyLaneIds,
  buildEmptyLaneNextSteps,
  type AutoDistributeResult,
} from './redistribute-elements-across-lanes';
import { calculateOptimalPoolSize } from '../../constants';
import { handleAssignElementsToLane, applyLaneAssignment } from './assign-elements-to-lane';

// ══════════════════════════════════════════════════════════════════════════════
// Inlined from by-type-distribution.ts
// ══════════════════════════════════════════════════════════════════════════════

const HUMAN_TASK_TYPES = new Set([
  'bpmn:UserTask',
  'bpmn:ManualTask',
  'bpmn:Task',
  'bpmn:SubProcess',
  'bpmn:CallActivity',
]);

/** Element types classified as automated tasks. */
const AUTOMATED_TASK_TYPES = new Set([
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
]);

/** Element types that are flow-control (events, gateways). */
const FLOW_CONTROL_TYPES = new Set([
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:BoundaryEvent',
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
]);

/** Non-assignable element types (structural, not flow elements). */
const NON_FLOW_TYPES = new Set(['bpmn:Lane', 'bpmn:LaneSet', 'label']);
const CONNECTION_TYPES = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow']);

export interface LaneDef {
  name: string;
  elementIds: string[];
}

/** Get child flow elements (non-structural, non-connection) of a participant. */
export function getChildFlowElements(elementRegistry: any, participantId: string): any[] {
  return elementRegistry.filter(
    (el: any) =>
      el.parent?.id === participantId &&
      !NON_FLOW_TYPES.has(el.type) &&
      !CONNECTION_TYPES.has(el.type) &&
      !el.type?.includes('Connection')
  );
}

function findBestLaneForElement(
  elementId: string,
  allElements: any[],
  laneAssignments: Map<string, number>
): number {
  const element = allElements.find((el: any) => el.id === elementId);
  if (!element) return 0;
  const votes = new Map<number, number>();
  for (const conn of element.incoming || []) {
    const srcId = conn.source?.id;
    if (srcId && laneAssignments.has(srcId)) {
      const idx = laneAssignments.get(srcId)!;
      votes.set(idx, (votes.get(idx) || 0) + 1);
    }
  }
  for (const conn of element.outgoing || []) {
    const tgtId = conn.target?.id;
    if (tgtId && laneAssignments.has(tgtId)) {
      const idx = laneAssignments.get(tgtId)!;
      votes.set(idx, (votes.get(idx) || 0) + 1);
    }
  }
  let best = 0;
  let max = 0;
  for (const [idx, count] of votes) {
    if (count > max) {
      max = count;
      best = idx;
    }
  }
  return best;
}

function categorizeByType(elements: any[]): LaneDef[] {
  const humanTaskIds: string[] = [];
  const automatedIds: string[] = [];
  const unassigned: string[] = [];

  for (const el of elements) {
    const type = el.type || '';
    if (HUMAN_TASK_TYPES.has(type)) {
      humanTaskIds.push(el.id);
    } else if (AUTOMATED_TASK_TYPES.has(type)) {
      automatedIds.push(el.id);
    } else if (FLOW_CONTROL_TYPES.has(type)) {
      unassigned.push(el.id);
    }
  }

  const lanes: LaneDef[] = [];
  if (humanTaskIds.length > 0) lanes.push({ name: 'Human Tasks', elementIds: humanTaskIds });
  if (automatedIds.length > 0) lanes.push({ name: 'Automated Tasks', elementIds: automatedIds });

  if (lanes.length === 1) {
    lanes[0].elementIds.push(...unassigned);
    return lanes;
  }
  if (lanes.length < 2) {
    // All same type: split by position
    const sorted = [...elements].sort((a: any, b: any) => (a.y || 0) - (b.y || 0));
    const mid = Math.ceil(sorted.length / 2);
    return [
      { name: 'Primary Tasks', elementIds: sorted.slice(0, mid).map((el: any) => el.id) },
      { name: 'Secondary Tasks', elementIds: sorted.slice(mid).map((el: any) => el.id) },
    ];
  }

  // Distribute unassigned elements by connectivity
  const laneAssignments = new Map<string, number>();
  for (let i = 0; i < lanes.length; i++) {
    for (const elId of lanes[i].elementIds) laneAssignments.set(elId, i);
  }
  for (const elId of unassigned) {
    const bestLane = findBestLaneForElement(elId, elements, laneAssignments);
    lanes[bestLane].elementIds.push(elId);
    laneAssignments.set(elId, bestLane);
  }
  return lanes;
}

/** Build lane definitions by categorizing elements by their BPMN type. */
export function buildByTypeLaneDefs(elements: any[], _elementRegistry: any): LaneDef[] {
  return categorizeByType(elements);
}

/** Build the next-steps hints for the create-lanes response. */
export function buildCreateLanesNextSteps(
  distributeAssignedCount?: number
): Array<{ tool: string; description: string }> {
  const steps: Array<{ tool: string; description: string }> = [];
  if (distributeAssignedCount && distributeAssignedCount > 0) {
    steps.push({
      tool: 'layout_bpmn_diagram',
      description: 'Run layout to organize elements within their assigned lanes.',
    });
  }
  steps.push(
    {
      tool: 'add_bpmn_elements',
      description:
        'Add elements to a specific lane using the laneId parameter for automatic vertical centering',
    },
    {
      tool: 'move_bpmn_element',
      description: 'Move existing elements into lanes using the laneId parameter',
    },
    {
      tool: 'create_bpmn_lanes',
      description:
        'Bulk-assign existing elements to lanes (assignments: [{ laneId, elementIds }], no lanes needed)',
    }
  );
  return steps;
}

import { handleConvertCollaborationToLanes } from './convert-collaboration-to-lanes';

export interface CreateLanesArgs {
  diagramId: string;
  /**
   * The participant (pool) to add lanes to. Required for creating lanes and
   * mergeFrom; optional for assignments and redistribution (strategy).
   */
  participantId?: string;
  /** Assign existing elements to existing lanes (no lane creation). */
  assignments?: Array<{ laneId: string; elementIds: string[] }>;
  /** Reposition elements vertically into their lane when assigning/redistributing. Default true. */
  reposition?: boolean;
  /** Redistribute elements across existing lanes (instead of creating lanes). */
  strategy?: 'role-based' | 'balance' | 'minimize-crossings';
  /** For strategy: return the plan without applying changes. */
  dryRun?: boolean;
  /** For strategy: validate lane organization before and after. */
  validate?: boolean;
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
  /**
   * Convert a multi-pool collaboration into lanes. Provide the ID of the main pool
   * to keep; other expanded pools become lanes within it. Elements are moved and
   * message flows are converted to sequence flows.
   */
  mergeFrom?: string;
  /** When true (default), runs layout after mergeFrom conversion. */
  layout?: boolean;
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
  const { distributeStrategy } = args;
  const participantId = args.participantId as string;
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

// ── Assignments mode ───────────────────────────────────────────────────────

/** Assign elements to existing lanes; lanes are validated up front, XML synced and linted once. */
async function handleAssignments(args: CreateLanesArgs): Promise<ToolResult> {
  const { diagramId, assignments = [], reposition = true } = args;
  if (assignments.length === 0) throw missingRequiredError(['assignments (at least 1 required)']);
  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  for (const a of assignments) {
    if (!a.laneId || !Array.isArray(a.elementIds) || a.elementIds.length === 0) {
      throw missingRequiredError(['laneId and elementIds in each assignment']);
    }
    const lane = requireElement(elementRegistry, a.laneId);
    if (lane.type !== 'bpmn:Lane') throw typeMismatchError(a.laneId, lane.type, ['bpmn:Lane']);
  }

  const outcomes = assignments.map((a) =>
    applyLaneAssignment(diagram, a.laneId, a.elementIds, reposition)
  );
  await syncXml(diagram);

  // Suggest deleting lanes the reassignment left empty (per affected pool)
  const poolIds = new Set<string>(
    assignments.map((a) => elementRegistry.get(a.laneId)?.parent?.id as string).filter(Boolean)
  );
  const emptyLaneIds = [...poolIds].flatMap((id) => findEmptyLaneIds(elementRegistry, id));

  const result = jsonResult({
    success: true,
    assignments: outcomes.map((o) => ({
      laneId: o.laneId,
      laneName: o.laneName,
      assignedElementIds: o.assigned,
      ...(o.skipped.length > 0 ? { skipped: o.skipped } : {}),
    })),
    ...(outcomes.some((o) => o.repositionWarnings.length > 0)
      ? { repositionWarnings: outcomes.flatMap((o) => o.repositionWarnings) }
      : {}),
    message: `Assigned elements to ${outcomes.length} lane(s)`,
    nextSteps: [
      {
        tool: 'layout_bpmn_diagram',
        description: 'Re-layout the diagram to position elements within their lanes.',
      },
      ...buildEmptyLaneNextSteps(emptyLaneIds, elementRegistry),
    ],
  });
  return appendLintFeedback(result, diagram);
}

// ── Form validation ────────────────────────────────────────────────────────

/** Reject calls that mix the mutually exclusive forms of create_bpmn_lanes. */
function assertSingleForm(args: CreateLanesArgs): void {
  const forms: Array<[string, boolean]> = [
    ['assignments', !!args.assignments],
    ['strategy', !!args.strategy],
    ['mergeFrom', !!args.mergeFrom],
    [
      'lanes/distributeStrategy/autoDistribute',
      !!(args.lanes || args.distributeStrategy || args.autoDistribute),
    ],
  ];
  const used = forms.filter(([, on]) => on).map(([name]) => name);
  if (used.length > 1) {
    throw illegalCombinationError(
      `create_bpmn_lanes forms are mutually exclusive, but got: ${used.join(', ')}. ` +
        'Call once to create lanes (lanes + elementIds), then again to assign (assignments) ' +
        'or redistribute (strategy).',
      used
    );
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleCreateLanes(args: CreateLanesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  assertSingleForm(args);

  if (args.assignments) return handleAssignments(args);
  if (args.strategy) {
    return handleRedistributeElementsAcrossLanes({
      diagramId: args.diagramId,
      participantId: args.participantId,
      strategy: args.strategy,
      dryRun: args.dryRun,
      validate: args.validate,
      reposition: args.reposition,
    });
  }
  validateArgs(args, ['participantId']);
  const participantId = args.participantId as string;

  // MergeFrom mode: convert collaboration pools into lanes
  if (args.mergeFrom) {
    return handleConvertCollaborationToLanes({
      diagramId: args.diagramId,
      mainParticipantId: args.mergeFrom,
      layout: args.layout,
    });
  }

  const { diagramId, autoDistribute = false, distributeStrategy } = args;

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
        'Use create_bpmn_lanes with assignments to modify lane assignments, or delete existing lanes first.'
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

// Schema extracted to create-lanes-schema.ts for readability.
export { TOOL_DEFINITION } from './create-lanes-schema';
