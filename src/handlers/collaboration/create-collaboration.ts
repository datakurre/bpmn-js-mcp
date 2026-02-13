/**
 * Handler for create_bpmn_collaboration tool.
 *
 * Higher-level helper for creating collaboration diagrams with multiple
 * participants (pools) and optional message flows between them.
 */

import { type ToolResult } from '../../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  validateArgs,
} from '../helpers';
import { appendLintFeedback } from '../../linter';
import { ELEMENT_SIZES } from '../../constants';

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
  const modeling = diagram.modeler.get('modeling');
  const elementFactory = diagram.modeler.get('elementFactory');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const canvas = diagram.modeler.get('canvas');

  // Use explicit participantId if provided, otherwise generate one
  let id: string;
  if (p.participantId) {
    if (elementRegistry.get(p.participantId)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Participant ID "${p.participantId}" already exists in the diagram. Choose a unique ID.`
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

  const createdElement = modeling.createShape(shape, { x, y }, canvas.getRootElement());
  modeling.updateProperties(createdElement, { name: p.name });

  if (p.collapsed && createdElement.di) createdElement.di.isExpanded = false;

  modeling.resizeShape(createdElement, {
    x: createdElement.x,
    y: createdElement.y,
    width: p.width || createdElement.width,
    height: poolHeight,
  });

  if (p.processId && createdElement.businessObject?.processRef) {
    createdElement.businessObject.processRef.id = p.processId;
  }

  return createdElement.id;
}

export async function handleCreateCollaboration(
  args: CreateCollaborationArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'participants']);
  const { diagramId, participants } = args;

  if (!participants || participants.length < 2) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'At least 2 participants are required to create a collaboration diagram'
    );
  }

  const diagram = requireDiagram(diagramId);

  const createdIds: string[] = [];
  const defaultPoolHeight = ELEMENT_SIZES.participant.height;

  for (let i = 0; i < participants.length; i++) {
    createdIds.push(
      createParticipantShape(diagram, participants[i], i, participants, defaultPoolHeight)
    );
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    participantIds: createdIds,
    participantCount: createdIds.length,
    message: `Created collaboration with ${createdIds.length} participants: ${createdIds.join(', ')}`,
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

export const TOOL_DEFINITION = {
  name: 'create_bpmn_collaboration',
  description:
    'Create a collaboration diagram with multiple participants (pools). **Camunda 7 / Operaton pattern:** Only one pool can be deployed and executed — additional pools must be **collapsed** (set collapsed: true) and serve only to document message flow endpoints. The executable pool contains the full process (start → tasks → end); collapsed pools are thin bars representing external systems or partners. Message flows connect elements in the expanded pool to collapsed pool shapes directly. For simple integrations where the external system is not a meaningful message partner, prefer bpmn:ServiceTask (camunda:type="external", camunda:topic) instead of a collaboration. Requires at least 2 participants.',
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
    ],
  },
} as const;
