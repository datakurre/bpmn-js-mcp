/**
 * Handler for split_bpmn_participant_into_lanes tool.
 *
 * Analyzes existing elements inside a participant pool and automatically
 * distributes them into lanes based on a chosen strategy (by task type,
 * or by explicit lane definitions with element lists).
 */
// @mutating

import { type ToolResult } from '../../types';
import { typeMismatchError, missingRequiredError, illegalCombinationError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';
import { handleCreateLanes } from './create-lanes';
import { handleAssignElementsToLane } from './assign-elements-to-lane';

export interface SplitParticipantIntoLanesArgs {
  diagramId: string;
  /** The participant (pool) to split into lanes. */
  participantId: string;
  /** Strategy for distributing elements. Default: 'by-type'. */
  strategy?: 'by-type' | 'manual';
  /** For 'manual' strategy: explicit lane definitions with element assignments. */
  lanes?: Array<{
    name: string;
    elementIds: string[];
    height?: number;
  }>;
}

/** Element types classified as human/manual tasks. */
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

/** Element types that are not directly categorizable (events, gateways). */
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

/** Categorize elements by their BPMN type into human-readable lane groups. */
function categorizeByType(elements: any[]): {
  lanes: Array<{ name: string; elementIds: string[] }>;
  unassigned: string[];
} {
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

  const lanes: Array<{ name: string; elementIds: string[] }> = [];

  if (humanTaskIds.length > 0) {
    lanes.push({ name: 'Human Tasks', elementIds: humanTaskIds });
  }
  if (automatedIds.length > 0) {
    lanes.push({ name: 'Automated Tasks', elementIds: automatedIds });
  }

  // If all elements end up in one category, assign unassigned to it
  if (lanes.length === 1) {
    lanes[0].elementIds.push(...unassigned);
    return { lanes, unassigned: [] };
  }

  return { lanes, unassigned };
}

/**
 * Find the best lane for an unassigned element (event/gateway) by looking
 * at its connected elements and choosing the lane with most connections.
 */
function findBestLaneForElement(
  elementId: string,
  elementRegistry: any,
  laneAssignments: Map<string, number>
): number {
  const element = elementRegistry.get(elementId);
  if (!element) return 0;

  const connectionCounts: Map<number, number> = new Map();

  // Check incoming connections
  const incoming = element.incoming || [];
  for (const conn of incoming) {
    const sourceId = conn.source?.id;
    if (sourceId) {
      const laneIdx = laneAssignments.get(sourceId);
      if (laneIdx !== undefined) {
        connectionCounts.set(laneIdx, (connectionCounts.get(laneIdx) || 0) + 1);
      }
    }
  }

  // Check outgoing connections
  const outgoing = element.outgoing || [];
  for (const conn of outgoing) {
    const targetId = conn.target?.id;
    if (targetId) {
      const laneIdx = laneAssignments.get(targetId);
      if (laneIdx !== undefined) {
        connectionCounts.set(laneIdx, (connectionCounts.get(laneIdx) || 0) + 1);
      }
    }
  }

  // Return lane with most connections, default to first lane
  let bestLane = 0;
  let maxCount = 0;
  for (const [laneIdx, count] of connectionCounts) {
    if (count > maxCount) {
      maxCount = count;
      bestLane = laneIdx;
    }
  }
  return bestLane;
}

/** Non-assignable element types (structural, not flow elements). */
const NON_FLOW_TYPES = new Set(['bpmn:Lane', 'bpmn:LaneSet', 'label']);

/** Connection types to exclude. */
const CONNECTION_TYPES = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow']);

/** Get flow elements inside a participant (excludes lanes, connections, labels). */
function getChildFlowElements(elementRegistry: any, participantId: string): any[] {
  return elementRegistry.filter(
    (el: any) =>
      el.parent?.id === participantId &&
      !NON_FLOW_TYPES.has(el.type) &&
      !CONNECTION_TYPES.has(el.type) &&
      !el.type?.includes('Connection')
  );
}

/** Build lane definitions using the by-type strategy. */
function buildByTypeLaneDefs(
  childElements: any[],
  elementRegistry: any
): Array<{ name: string; elementIds: string[] }> {
  const categorized = categorizeByType(childElements);
  const laneDefs = categorized.lanes;

  if (laneDefs.length < 2) {
    // All elements are the same type — split by position (top/bottom half)
    return splitByPosition(childElements);
  }

  // Distribute unassigned elements (events, gateways) to best lanes
  distributeUnassigned(childElements, laneDefs, elementRegistry);
  return laneDefs;
}

/** Split elements into two lanes by Y-position. */
function splitByPosition(elements: any[]): Array<{ name: string; elementIds: string[] }> {
  const sorted = [...elements].sort((a: any, b: any) => (a.y || 0) - (b.y || 0));
  const midpoint = Math.ceil(sorted.length / 2);
  return [
    { name: 'Primary Tasks', elementIds: sorted.slice(0, midpoint).map((el: any) => el.id) },
    { name: 'Secondary Tasks', elementIds: sorted.slice(midpoint).map((el: any) => el.id) },
  ];
}

/** Distribute unassigned elements to the best lane by connectivity. */
function distributeUnassigned(
  childElements: any[],
  laneDefs: Array<{ name: string; elementIds: string[] }>,
  elementRegistry: any
): void {
  const laneAssignments = new Map<string, number>();
  for (let i = 0; i < laneDefs.length; i++) {
    for (const elId of laneDefs[i].elementIds) {
      laneAssignments.set(elId, i);
    }
  }
  for (const el of childElements) {
    if (!laneAssignments.has(el.id)) {
      const bestLane = findBestLaneForElement(el.id, elementRegistry, laneAssignments);
      laneDefs[bestLane].elementIds.push(el.id);
      laneAssignments.set(el.id, bestLane);
    }
  }
}

/** Extract lane IDs from a handleCreateLanes result. */
function extractLaneIds(result: ToolResult, elementRegistry: any, participantId: string): string[] {
  const text = result.content?.[0];
  if (text && 'text' in text) {
    try {
      const parsed = JSON.parse(text.text as string);
      if (parsed.laneIds) return parsed.laneIds;
    } catch {
      // Fall through to registry lookup
    }
  }
  // Fallback: find newly created lanes in registry
  return elementRegistry
    .filter((el: any) => el.type === 'bpmn:Lane' && el.parent?.id === participantId)
    .map((l: any) => l.id);
}

/** Validate and return manual lane definitions. */
function validateManualLanes(
  lanes: Array<{ name: string; elementIds: string[] }> | undefined
): Array<{ name: string; elementIds: string[] }> {
  if (!lanes || lanes.length < 2) {
    throw missingRequiredError(['lanes (at least 2 required for manual strategy)']);
  }
  return lanes;
}

export async function handleSplitParticipantIntoLanes(
  args: SplitParticipantIntoLanesArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'participantId']);
  const { diagramId, participantId, strategy = 'by-type' } = args;

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const participant = requireElement(elementRegistry, participantId);
  if (participant.type !== 'bpmn:Participant') {
    throw typeMismatchError(participantId, participant.type, ['bpmn:Participant']);
  }

  // Check if participant already has lanes
  const existingLanes = elementRegistry
    .filter((el: any) => el.type === 'bpmn:Lane')
    .filter((el: any) => el.parent?.id === participantId);
  if (existingLanes.length > 0) {
    throw illegalCombinationError(
      `Participant "${participantId}" already has ${existingLanes.length} lane(s). ` +
        'Use assign_bpmn_elements_to_lane to reassign elements, or delete existing lanes first.',
      ['participantId']
    );
  }

  const childElements = getChildFlowElements(elementRegistry, participantId);
  if (childElements.length === 0) {
    return jsonResult({
      success: false,
      message: `Participant "${participantId}" has no elements to distribute into lanes.`,
    });
  }

  const laneDefs =
    strategy === 'manual'
      ? validateManualLanes(args.lanes)
      : buildByTypeLaneDefs(childElements, elementRegistry);

  // Create the lanes
  const createResult = await handleCreateLanes({
    diagramId,
    participantId,
    lanes: laneDefs.map((l) => ({ name: l.name })),
  });

  const laneIds = extractLaneIds(createResult, elementRegistry, participantId);

  // Assign elements to their respective lanes
  const assignments: Record<string, string[]> = {};
  for (let i = 0; i < Math.min(laneDefs.length, laneIds.length); i++) {
    if (laneDefs[i].elementIds.length > 0) {
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[i],
        elementIds: laneDefs[i].elementIds,
        reposition: true,
      });
      assignments[laneIds[i]] = laneDefs[i].elementIds;
    }
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    participantId,
    strategy,
    laneIds,
    laneNames: laneDefs.map((l) => l.name),
    assignments,
    message: `Split participant "${participantId}" into ${laneIds.length} lanes (${strategy} strategy): ${laneDefs.map((l) => `"${l.name}" (${l.elementIds.length} elements)`).join(', ')}`,
    nextSteps: [
      {
        tool: 'assign_bpmn_elements_to_lane',
        description: 'Move elements between lanes if the automatic assignment needs adjustment',
      },
      {
        tool: 'layout_bpmn_diagram',
        description: 'Re-layout the diagram to arrange elements within their lanes',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

/** @deprecated Not registered as an MCP tool — subsumed by create_bpmn_lanes. */
const _UNUSED_TOOL_DEFINITION = {
  name: 'split_bpmn_participant_into_lanes',
  description:
    'Automatically split an existing participant pool into lanes and distribute elements. ' +
    "Uses 'by-type' strategy (default) to categorize elements by BPMN type " +
    '(UserTask/ManualTask → "Human Tasks", ServiceTask/ScriptTask → "Automated Tasks"), ' +
    "or 'manual' strategy with explicit lane definitions. Events and gateways are " +
    'assigned to the lane with the most connected tasks to minimize cross-lane flows. ' +
    'The participant must not already have lanes.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      participantId: {
        type: 'string',
        description: 'The ID of the participant (pool) to split into lanes',
      },
      strategy: {
        type: 'string',
        enum: ['by-type', 'manual'],
        description:
          "Strategy for distributing elements. 'by-type' (default): auto-categorize by BPMN element type. " +
          "'manual': provide explicit lane definitions with element IDs.",
      },
      lanes: {
        type: 'array',
        description:
          "For 'manual' strategy: explicit lane definitions with element assignments (at least 2)",
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Lane name' },
            elementIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Element IDs to assign to this lane',
            },
            height: {
              type: 'number',
              description: 'Optional lane height in pixels',
            },
          },
          required: ['name', 'elementIds'],
        },
        minItems: 2,
      },
    },
    required: ['diagramId', 'participantId'],
  },
} as const;
