/**
 * Handler for handoff_bpmn_to_lane tool.
 *
 * Creates a clean cross-lane (or cross-pool) handoff by:
 * 1. Creating a new element in the target lane
 * 2. Connecting the source element to the new element
 *
 * This reduces the multi-step pattern of:
 *   add_bpmn_elements → create_bpmn_lanes with assignments → connect_bpmn_elements
 */
// @mutating

import { type ToolResult } from '../../types';
import { typeMismatchError, semanticViolationError } from '../../errors';
import { requireDiagram, requireElement, jsonResult, validateArgs, getService } from '../helpers';
import { appendLintFeedback } from '../../linter';
import { handleAddElement } from '../elements/add-element';
import { handleConnect } from '../elements/connect';

export interface HandoffToLaneArgs {
  diagramId: string;
  /** The source element ID (the element handing off work). */
  fromElementId: string;
  /** The target lane ID where the new element should be placed. */
  toLaneId: string;
  /** Element type for the new handoff target. Default: 'bpmn:UserTask'. */
  elementType?: string;
  /** Name for the new element. */
  name?: string;
  /** Label for the connection (sequence flow or message flow). */
  connectionLabel?: string;
}

/** Element types valid for handoff targets. */
const VALID_HANDOFF_TYPES = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:CallActivity',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
]);

/**
 * Walk up the parent chain to find the owning Participant (pool).
 * Returns undefined if the element is not inside a Participant.
 */
function findParentParticipant(element: any): any | undefined {
  let current = element;
  while (current) {
    if (current.type === 'bpmn:Participant') return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * Find which participant (pool) a lane belongs to.
 */
function findLaneParticipant(elementRegistry: any, lane: any): any | undefined {
  // Walk up parent chain from the lane
  let current = lane.parent;
  while (current) {
    if (current.type === 'bpmn:Participant') return current;
    current = current.parent;
  }
  // Fallback: search all participants for this lane
  const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
  for (const p of participants) {
    const allChildren = elementRegistry.filter(
      (el: any) => el.type === 'bpmn:Lane' && el.parent?.parent?.id === p.id
    );
    if (allChildren.some((c: any) => c.id === lane.id)) return p;
  }
  return undefined;
}

export async function handleHandoffToLane(args: HandoffToLaneArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'fromElementId', 'toLaneId']);
  const { diagramId, fromElementId, toLaneId, connectionLabel } = args;
  const elementType = args.elementType || 'bpmn:UserTask';
  const name = args.name;

  if (!VALID_HANDOFF_TYPES.has(elementType)) {
    throw typeMismatchError('elementType', elementType, Array.from(VALID_HANDOFF_TYPES));
  }

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  // Validate source and target
  const fromElement = requireElement(elementRegistry, fromElementId);
  const lane = requireElement(elementRegistry, toLaneId);

  if (lane.type !== 'bpmn:Lane') {
    throw typeMismatchError(toLaneId, lane.type, ['bpmn:Lane']);
  }

  // Determine if source is in the same participant as the target lane
  const sourceParticipant = findParentParticipant(fromElement);
  const targetParticipant = findLaneParticipant(elementRegistry, lane);

  if (!targetParticipant) {
    throw semanticViolationError(
      `Lane "${toLaneId}" is not inside a participant. Cannot determine target pool.`
    );
  }

  const crossPool =
    sourceParticipant && targetParticipant && sourceParticipant.id !== targetParticipant.id;

  // Create the new element in the target lane
  const addResult = await handleAddElement({
    diagramId,
    elementType,
    name,
    participantId: targetParticipant.id,
    laneId: toLaneId,
  });

  const addParsed = JSON.parse(addResult.content[0].text!);
  const newElementId = addParsed.elementId;

  // Connect source to the new element
  const connectResult = await handleConnect({
    diagramId,
    sourceElementId: fromElementId,
    targetElementId: newElementId,
    label: connectionLabel,
    // Connection type is auto-detected: SequenceFlow for same-pool, MessageFlow for cross-pool
  });

  const connectParsed = JSON.parse(connectResult.content[0].text!);
  const connectionId = connectParsed.connectionId;
  const connectionType =
    connectParsed.connectionType || (crossPool ? 'bpmn:MessageFlow' : 'bpmn:SequenceFlow');

  const result = jsonResult({
    success: true,
    createdElementId: newElementId,
    connectionId,
    connectionType,
    crossPool: !!crossPool,
    fromElementId,
    toLaneId,
    laneName: lane.businessObject?.name || toLaneId,
    message:
      `Created ${elementType.replace('bpmn:', '')}${name ? ` "${name}"` : ''} in lane ` +
      `"${lane.businessObject?.name || toLaneId}" and connected from "${fromElement.businessObject?.name || fromElementId}" ` +
      `via ${connectionType.replace('bpmn:', '')}${connectionLabel ? ` ("${connectionLabel}")` : ''}`,
    nextSteps: [
      {
        tool: 'set_bpmn_element_properties',
        description: `Configure the new element ${newElementId} (e.g. assignee, form)`,
      },
      ...(crossPool
        ? [
            {
              tool: 'manage_bpmn_root_elements',
              description: 'Define message definitions for cross-pool message flows',
            },
          ]
        : []),
    ],
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'handoff_bpmn_to_lane',
  description:
    'Create a clean cross-lane handoff by adding a new element in a target lane and connecting it ' +
    'from a source element. Automatically detects whether to use SequenceFlow (same pool) or ' +
    'MessageFlow (cross-pool). Reduces the multi-step pattern of add_bpmn_elements + ' +
    'create_bpmn_lanes with assignments + connect_bpmn_elements into a single call. ' +
    'Useful when modeling work handoffs between roles/departments represented as lanes.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      fromElementId: {
        type: 'string',
        description: 'The source element ID (the element handing off work)',
      },
      toLaneId: {
        type: 'string',
        description: 'The target lane ID where the new element should be placed',
      },
      elementType: {
        type: 'string',
        description: 'Element type for the handoff target (default: bpmn:UserTask)',
        enum: Array.from(VALID_HANDOFF_TYPES),
      },
      name: {
        type: 'string',
        description: 'Name for the new element',
      },
      connectionLabel: {
        type: 'string',
        description: 'Label for the connecting flow (e.g. "Hand off to manager")',
      },
    },
    required: ['diagramId', 'fromElementId', 'toLaneId'],
  },
} as const;
