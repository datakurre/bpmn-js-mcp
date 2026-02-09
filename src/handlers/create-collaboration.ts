/**
 * Handler for create_bpmn_collaboration tool.
 *
 * Higher-level helper for creating collaboration diagrams with multiple
 * participants (pools) and optional message flows between them.
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  validateArgs,
} from './helpers';
import { appendLintFeedback } from '../linter';
import { ELEMENT_SIZES } from '../constants';

/** Height of a collapsed participant pool (thin bar, no internal flow). */
const COLLAPSED_POOL_HEIGHT = 60;

export interface CreateCollaborationArgs {
  diagramId: string;
  participants: Array<{
    name: string;
    processId?: string;
    collapsed?: boolean;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  }>;
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
  const modeling = diagram.modeler.get('modeling');
  const elementFactory = diagram.modeler.get('elementFactory');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const canvas = diagram.modeler.get('canvas');

  const createdIds: string[] = [];
  const defaultPoolHeight = ELEMENT_SIZES.participant.height;
  const verticalGap = 30;

  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    const id = generateDescriptiveId(elementRegistry, 'bpmn:Participant', p.name);
    const poolHeight = p.height || (p.collapsed ? COLLAPSED_POOL_HEIGHT : defaultPoolHeight);
    const prevBottom =
      i === 0
        ? 100
        : (() => {
            // Sum up previous participants' heights + gaps
            let y = 100;
            for (let j = 0; j < i; j++) {
              const h = participants[j].height ||
                (participants[j].collapsed ? COLLAPSED_POOL_HEIGHT : defaultPoolHeight);
              y += h + verticalGap;
            }
            return y;
          })();
    const y = p.y ?? prevBottom;
    const x = p.x ?? 300;

    const shapeAttrs: Record<string, any> = {
      type: 'bpmn:Participant',
      id,
    };
    if (p.collapsed) {
      shapeAttrs.isExpanded = false;
    }
    const shape = elementFactory.createShape(shapeAttrs);

    // Apply custom dimensions before placement
    if (p.width) shape.width = p.width;
    shape.height = poolHeight;

    const rootElement = canvas.getRootElement();
    const createdElement = modeling.createShape(shape, { x, y }, rootElement);
    modeling.updateProperties(createdElement, { name: p.name });

    // Mark collapsed pools in the DI and resize
    if (p.collapsed && createdElement.di) {
      createdElement.di.isExpanded = false;
    }

    // Resize to requested or default dimensions
    const newBounds = {
      x: createdElement.x,
      y: createdElement.y,
      width: p.width || createdElement.width,
      height: poolHeight,
    };
    modeling.resizeShape(createdElement, newBounds);

    if (p.processId) {
      const bo = createdElement.businessObject;
      if (bo.processRef) {
        bo.processRef.id = p.processId;
      }
    }

    createdIds.push(createdElement.id);
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    participantIds: createdIds,
    participantCount: createdIds.length,
    message: `Created collaboration with ${createdIds.length} participants: ${createdIds.join(', ')}`,
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
  },
} as const;
