/**
 * Handler for create_bpmn_collaboration tool.
 *
 * Higher-level helper for creating collaboration diagrams with multiple
 * participants (pools) and optional message flows between them.
 */
// @mutating

import { type ToolResult } from '../../types';
import { duplicateError, missingRequiredError } from '../../errors';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';
import { ELEMENT_SIZES, calculateOptimalPoolSize } from '../../constants';
import { handleCreateLanes } from './create-lanes';
import { ensureProcessRef } from './collaboration-utils';

/** Height of a collapsed participant pool (thin bar, no internal flow). */
const COLLAPSED_POOL_HEIGHT = 60;

export interface CreateCollaborationArgs {
  diagramId: string;
  participants: Array<{
    name: string;
    participantId?: string;
    processId?: string;
    collapsed?: boolean;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    /** Optional lanes to create within this participant (requires at least 2). Ignored for collapsed pools. */
    lanes?: Array<{ name: string; height?: number }>;
  }>;
}

/** Compute the Y position for participant at index i. */
function computeParticipantY(
  participants: CreateCollaborationArgs['participants'],
  index: number,
  defaultPoolHeight: number
): number {
  if (index === 0) return 100;
  let y = 100;
  const verticalGap = 30;
  for (let j = 0; j < index; j++) {
    const h =
      participants[j].height ||
      (participants[j].collapsed ? COLLAPSED_POOL_HEIGHT : defaultPoolHeight);
    y += h + verticalGap;
  }
  return y;
}

/** Create a single participant pool shape in the diagram. */
function createParticipantShape(
  diagram: any,
  p: CreateCollaborationArgs['participants'][number],
  index: number,
  participants: CreateCollaborationArgs['participants'],
  defaultPoolHeight: number
): string {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementFactory = getService(diagram.modeler, 'elementFactory');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const canvas = getService(diagram.modeler, 'canvas');

  // Use explicit participantId if provided, otherwise generate one
  let id: string;
  if (p.participantId) {
    if (elementRegistry.get(p.participantId)) {
      throw duplicateError(
        `Participant ID "${p.participantId}" already exists in the diagram. Choose a unique ID.`,
        [p.participantId]
      );
    }
    id = p.participantId;
  } else {
    id = generateDescriptiveId(elementRegistry, 'bpmn:Participant', p.name);
  }
  const poolHeight = p.height || (p.collapsed ? COLLAPSED_POOL_HEIGHT : defaultPoolHeight);
  const y = p.y ?? computeParticipantY(participants, index, defaultPoolHeight);
  const x = p.x ?? 300;

  const shapeAttrs: Record<string, any> = { type: 'bpmn:Participant', id };
  if (p.collapsed) shapeAttrs.isExpanded = false;
  const shape = elementFactory.createShape(shapeAttrs);

  if (p.width) shape.width = p.width;
  shape.height = poolHeight;

  const createdElement = modeling.createShape(
    shape,
    { x, y: y + poolHeight / 2 },
    canvas.getRootElement()
  );
  modeling.updateProperties(createdElement, { name: p.name });

  if (p.collapsed && createdElement.di) createdElement.di.isExpanded = false;

  modeling.resizeShape(createdElement, {
    x: createdElement.x,
    y: createdElement.y,
    width: p.width || createdElement.width,
    height: poolHeight,
  });

  const moddle = getService(diagram.modeler, 'moddle');
  const canvasForRef = getService(diagram.modeler, 'canvas');
  ensureProcessRef(moddle, canvasForRef, createdElement, p.collapsed);

  if (p.processId && createdElement.businessObject?.processRef) {
    (createdElement.businessObject.processRef as { id: string }).id = p.processId;
  }

  return createdElement.id;
}

type ParticipantDef = CreateCollaborationArgs['participants'][number];

/** Apply dynamic pool sizing defaults for a single participant definition. */
function applyPoolSizeDefaults(p: ParticipantDef): ParticipantDef {
  const laneCount = p.lanes && !p.collapsed ? p.lanes.length : 0;
  const optimal =
    laneCount > 0
      ? calculateOptimalPoolSize(0, laneCount)
      : { width: ELEMENT_SIZES.participant.width, height: ELEMENT_SIZES.participant.height };
  return {
    ...p,
    width: p.width ?? optimal.width,
    height: p.height ?? (p.collapsed ? undefined : optimal.height),
  };
}

/** Create lanes for participants that requested them. Returns a map of participantId → laneIds. */
async function createLanesForParticipants(
  diagramId: string,
  participants: ParticipantDef[],
  createdIds: string[]
): Promise<Record<string, string[]>> {
  const lanesCreated: Record<string, string[]> = {};
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    if (!p.lanes || p.lanes.length < 2 || p.collapsed) continue;
    const lanesResult = await handleCreateLanes({
      diagramId,
      participantId: createdIds[i],
      lanes: p.lanes,
    });
    const lanesText = lanesResult.content?.[0];
    if (lanesText && 'text' in lanesText) {
      try {
        const parsed = JSON.parse(lanesText.text as string);
        if (parsed.laneIds) lanesCreated[createdIds[i]] = parsed.laneIds;
      } catch {
        // Non-fatal: lanes were created but we couldn't parse the result
      }
    }
  }
  return lanesCreated;
}

export async function handleCreateCollaboration(
  args: CreateCollaborationArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'participants']);
  const { diagramId, participants } = args;

  if (!participants || participants.length < 2) {
    throw missingRequiredError(['participants']);
  }

  const diagram = requireDiagram(diagramId);

  const createdIds: string[] = [];

  for (let i = 0; i < participants.length; i++) {
    const pWithDefaults = applyPoolSizeDefaults(participants[i]);
    const optimalHeight = pWithDefaults.height ?? ELEMENT_SIZES.participant.height;
    createdIds.push(createParticipantShape(diagram, pWithDefaults, i, participants, optimalHeight));
  }

  await syncXml(diagram);

  const lanesCreated = await createLanesForParticipants(diagramId, participants, createdIds);

  const result = jsonResult({
    success: true,
    participantIds: createdIds,
    participantCount: createdIds.length,
    ...(Object.keys(lanesCreated).length > 0 ? { lanesCreated } : {}),
    message: `Created collaboration with ${createdIds.length} participants: ${createdIds.join(', ')}${Object.keys(lanesCreated).length > 0 ? ` (with lanes in ${Object.keys(lanesCreated).length} participant(s))` : ''}`,
    nextSteps: [
      {
        tool: 'add_bpmn_element',
        description:
          'Add start events, tasks, and end events inside the executable (expanded) pool using participantId',
      },
      {
        tool: 'connect_bpmn_elements',
        description:
          'Create message flows between the expanded pool elements and collapsed partner pools to document message exchanges',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

/** @deprecated Not registered as an MCP tool — subsumed by create_bpmn_participant. */
const _UNUSED_TOOL_DEFINITION = {
  name: 'create_bpmn_collaboration',
  description:
    'Create a collaboration diagram with multiple participants (pools). ' +
    '**⚠ Lanes vs Pools:** If you need role separation within a single organization/process ' +
    '(e.g. Requester, Approver, Finance), use **lanes** inside one expanded pool — NOT multiple expanded pools. ' +
    'Multiple expanded pools represent separate organizations/systems that communicate via message flows. ' +
    '**Camunda 7 / Operaton pattern:** Only one pool can be deployed and executed — additional pools must be ' +
    '**collapsed** (set collapsed: true) and serve only to document message flow endpoints. ' +
    'The executable pool contains the full process (start → tasks → end); collapsed pools are thin bars ' +
    'representing external systems or partners. Message flows connect elements in the expanded pool to ' +
    'collapsed pool shapes directly. For simple integrations where the external system is not a meaningful ' +
    'message partner, prefer bpmn:ServiceTask (camunda:type="external", camunda:topic) instead of a collaboration. ' +
    'Requires at least 2 participants.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      participants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Participant/pool name' },
            participantId: {
              type: 'string',
              description:
                'Optional explicit ID for the participant element. Must be unique. If omitted, a descriptive ID is generated from the name.',
            },
            processId: {
              type: 'string',
              description: 'Optional custom process ID for the participant',
            },
            collapsed: {
              type: 'boolean',
              description:
                'If true, creates a collapsed pool (thin bar, no internal flow). Use for non-executable partner pools in Camunda 7 / Operaton that only document message flow endpoints.',
            },
            width: {
              type: 'number',
              description: 'Optional pool width in pixels (default: 600)',
            },
            height: {
              type: 'number',
              description: 'Optional pool height in pixels (default: 250)',
            },
            x: {
              type: 'number',
              description: 'Optional X coordinate for pool center (default: 300)',
            },
            y: {
              type: 'number',
              description: 'Optional Y coordinate for pool center (default: auto-stacked)',
            },
            lanes: {
              type: 'array',
              description:
                'Optional lanes to create within this participant (requires at least 2). ' +
                'Ignored for collapsed pools. Creates a bpmn:LaneSet dividing the pool height evenly.',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Lane name (typically a role or department)',
                  },
                  height: {
                    type: 'number',
                    description:
                      'Optional lane height in pixels. If omitted, the pool height is divided evenly.',
                  },
                },
                required: ['name'],
              },
              minItems: 2,
            },
          },
          required: ['name'],
        },
        description: 'Array of participants to create (minimum 2)',
        minItems: 2,
      },
    },
    required: ['diagramId', 'participants'],
    examples: [
      {
        title: 'Camunda 7 pattern: one executable pool + one collapsed partner pool',
        value: {
          diagramId: '<diagram-id>',
          participants: [
            { name: 'Order Processing', processId: 'Process_OrderProcessing' },
            { name: 'Customer', collapsed: true },
          ],
        },
      },
      {
        title: 'Pool with swimlanes for role separation',
        value: {
          diagramId: '<diagram-id>',
          participants: [
            {
              name: 'HR Department',
              lanes: [{ name: 'Recruiter' }, { name: 'Hiring Manager' }, { name: 'HR Admin' }],
            },
            { name: 'Candidate', collapsed: true },
          ],
        },
      },
    ],
  },
} as const;
