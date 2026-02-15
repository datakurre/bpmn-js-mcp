/**
 * Handler for create_bpmn_participant tool.
 *
 * Creates participant(s) (pools) in a diagram. Supports both single-pool
 * creation (via `name`) and multi-pool collaboration creation (via
 * `participants` array, merged from the former create_bpmn_collaboration tool).
 *
 * If the diagram is a plain process, it is first wrapped in a collaboration.
 */
// @mutating

import { type ToolResult } from '../../types';
import { duplicateError } from '../../errors';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  validateArgs,
} from '../helpers';
import { getService } from '../../bpmn-types';
import { appendLintFeedback } from '../../linter';
import { ELEMENT_SIZES, calculateOptimalPoolSize } from '../../constants';
import { handleCreateLanes } from './create-lanes';
import { ensureProcessRef } from './collaboration-utils';
import { handleCreateCollaboration } from './create-collaboration';

/** Height of a collapsed participant pool. */
const COLLAPSED_POOL_HEIGHT = 60;
const BPMN_PARTICIPANT = 'bpmn:Participant';

export interface CreateParticipantArgs {
  diagramId: string;
  /** Name for the participant/pool (single-pool mode). */
  name?: string;
  /** Optional explicit participant element ID. */
  participantId?: string;
  /** Optional process ID for the participant's process reference. */
  processId?: string;
  /** If true, creates a collapsed pool (thin bar). Default: false (expanded). */
  collapsed?: boolean;
  /** Pool width in pixels. Default: 600. */
  width?: number;
  /** Pool height in pixels. Default: 250. */
  height?: number;
  /** X coordinate. Default: auto-positioned. */
  x?: number;
  /** Y coordinate. Default: auto-positioned below existing participants. */
  y?: number;
  /** Optional lanes to create within this participant (requires at least 2). */
  lanes?: Array<{ name: string; height?: number }>;
  /** Multi-pool mode: create multiple participants at once (collaboration). Min 2. */
  participants?: Array<{
    name: string;
    participantId?: string;
    processId?: string;
    collapsed?: boolean;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    lanes?: Array<{ name: string; height?: number }>;
  }>;
}

/**
 * Find the bottom edge of the lowest participant in the diagram,
 * so the new pool can be placed below it.
 */
function findBottomEdge(elementRegistry: any): number {
  const participants = elementRegistry.filter((el: any) => el.type === BPMN_PARTICIPANT);
  if (participants.length === 0) return 100;

  let maxBottom = 0;
  for (const p of participants) {
    const bottom = (p.y ?? 0) + (p.height ?? 0);
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return maxBottom + 30; // 30px gap
}

/** Resolve or generate a unique participant ID. */
function resolveParticipantId(
  elementRegistry: any,
  explicitId: string | undefined,
  name: string
): string {
  if (explicitId) {
    if (elementRegistry.get(explicitId)) {
      throw duplicateError(`Participant ID "${explicitId}" already exists. Choose a unique ID.`, [
        explicitId,
      ]);
    }
    return explicitId;
  }
  return generateDescriptiveId(elementRegistry, BPMN_PARTICIPANT, name);
}

/** Create the pool shape and return the created element. */
function createPoolShape(diagram: any, id: string, name: string, args: CreateParticipantArgs): any {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementFactory = getService(diagram.modeler, 'elementFactory');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const canvas = getService(diagram.modeler, 'canvas') as any;

  // Use dynamic sizing when lanes are provided
  const laneCount = args.lanes && !args.collapsed ? args.lanes.length : 0;
  const optimal =
    laneCount > 0
      ? calculateOptimalPoolSize(0, laneCount)
      : { width: ELEMENT_SIZES.participant.width, height: ELEMENT_SIZES.participant.height };

  const poolHeight = args.height || (args.collapsed ? COLLAPSED_POOL_HEIGHT : optimal.height);
  const poolWidth = args.width || optimal.width;
  const x = args.x ?? 300;
  const y = args.y ?? findBottomEdge(elementRegistry);

  const shapeAttrs: Record<string, any> = { type: BPMN_PARTICIPANT, id };
  if (args.collapsed) shapeAttrs.isExpanded = false;
  const shape = elementFactory.createShape(shapeAttrs);
  shape.width = poolWidth;
  shape.height = poolHeight;

  const created = modeling.createShape(
    shape,
    { x, y: y + poolHeight / 2 },
    canvas.getRootElement()
  );
  modeling.updateProperties(created, { name });

  if (args.collapsed && created.di) {
    (created.di as any).isExpanded = false;
  }

  modeling.resizeShape(created, {
    x: created.x,
    y: created.y,
    width: poolWidth,
    height: poolHeight,
  });

  const moddle = getService(diagram.modeler, 'moddle');
  const canvasForRef = getService(diagram.modeler, 'canvas');
  ensureProcessRef(moddle, canvasForRef, created, args.collapsed);

  if (args.processId && created.businessObject?.processRef) {
    (created.businessObject.processRef as any).id = args.processId;
  }

  return created;
}

/** Try to create lanes and return their IDs, or undefined. */
async function tryCreateLanes(
  diagramId: string,
  participantId: string,
  lanes: Array<{ name: string; height?: number }> | undefined,
  collapsed: boolean | undefined
): Promise<string[] | undefined> {
  if (!lanes || lanes.length < 2 || collapsed) return undefined;
  const lanesResult = await handleCreateLanes({ diagramId, participantId, lanes });
  const lanesText = lanesResult.content?.[0];
  if (lanesText && 'text' in lanesText) {
    try {
      const parsed = JSON.parse(lanesText.text as string);
      if (parsed.laneIds) return parsed.laneIds as string[];
    } catch {
      // Non-fatal
    }
  }
  return undefined;
}

export async function handleCreateParticipant(args: CreateParticipantArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);

  // Multi-pool mode: delegate to create-collaboration handler
  if (args.participants && args.participants.length >= 2) {
    return handleCreateCollaboration({
      diagramId: args.diagramId,
      participants: args.participants,
    });
  }

  // Single-pool mode: requires name
  const participantName = args.name;
  if (!participantName) {
    throw new Error(
      'Missing required parameter: name (required for single-pool mode). ' +
        'Use "participants" array with at least 2 entries for multi-pool collaboration.'
    );
  }

  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const id = resolveParticipantId(elementRegistry, args.participantId, participantName);
  const created = createPoolShape(diagram, id, participantName, args);

  await syncXml(diagram);

  const laneIds = await tryCreateLanes(diagramId, created.id, args.lanes, args.collapsed);

  const result = jsonResult({
    success: true,
    participantId: created.id,
    processId: (created.businessObject as any)?.processRef?.id,
    collapsed: !!args.collapsed,
    ...(laneIds ? { laneIds } : {}),
    message: `Created participant "${participantName}" (${created.id})${args.processId ? ` with process ID "${args.processId}"` : ''}${laneIds ? ` with ${laneIds.length} lanes` : ''}`,
    nextSteps: [
      ...(!args.collapsed
        ? [
            {
              tool: 'add_bpmn_element',
              description: `Add elements inside the pool using participantId: "${created.id}"`,
            },
          ]
        : []),
      {
        tool: 'connect_bpmn_elements',
        description: 'Create message flows between pools',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'create_bpmn_participant',
  description:
    'Create participant(s) (pools) in a BPMN diagram. Supports two modes:\n' +
    '**Single pool** (name): Creates one participant. If the diagram is a plain process, ' +
    'it will be converted to a collaboration automatically.\n' +
    '**Multi-pool collaboration** (participants array): Creates multiple participants at once ' +
    '(minimum 2). **Camunda 7 / Operaton pattern:** Only one pool can be deployed and executed — ' +
    'additional pools must be **collapsed** (set collapsed: true) and serve only to document ' +
    'message flow endpoints. **Lanes vs Pools:** If you need role separation within a single ' +
    'organization/process (e.g. Requester, Approver, Finance), use **lanes** inside one expanded ' +
    'pool — NOT multiple expanded pools.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      name: {
        type: 'string',
        description: 'Participant/pool name (for single-pool mode)',
      },
      participantId: {
        type: 'string',
        description: 'Optional explicit element ID. If omitted, a descriptive ID is generated.',
      },
      processId: {
        type: 'string',
        description:
          'Optional process ID for the participant\'s process reference (e.g. "Process_OrderHandling").',
      },
      collapsed: {
        type: 'boolean',
        description:
          'If true, creates a collapsed pool (thin bar). Use for non-executable partner pools.',
      },
      width: { type: 'number', description: 'Pool width in pixels (default: 600)' },
      height: { type: 'number', description: 'Pool height in pixels (default: 250)' },
      x: { type: 'number', description: 'X coordinate (default: 300)' },
      y: {
        type: 'number',
        description: 'Y coordinate (default: auto-positioned below existing participants)',
      },
      lanes: {
        type: 'array',
        description: 'Optional lanes to create within this participant (requires at least 2).',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Lane name' },
            height: {
              type: 'number',
              description: 'Optional lane height. If omitted, pool height is divided evenly.',
            },
          },
          required: ['name'],
        },
        minItems: 2,
      },
      participants: {
        type: 'array',
        description:
          'Multi-pool mode: create multiple participants at once (collaboration). ' +
          'Requires at least 2 entries. When provided, single-pool parameters (name, collapsed, etc.) are ignored.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Participant/pool name' },
            participantId: {
              type: 'string',
              description: 'Optional explicit ID for the participant element.',
            },
            processId: {
              type: 'string',
              description: 'Optional custom process ID for the participant',
            },
            collapsed: {
              type: 'boolean',
              description:
                'If true, creates a collapsed pool (thin bar, no internal flow). Use for non-executable partner pools.',
            },
            width: { type: 'number', description: 'Optional pool width in pixels (default: 600)' },
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
                'Optional lanes to create within this participant (requires at least 2). Ignored for collapsed pools.',
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
                      'Optional lane height. If omitted, the pool height is divided evenly.',
                  },
                },
                required: ['name'],
              },
              minItems: 2,
            },
          },
          required: ['name'],
        },
        minItems: 2,
      },
    },
    required: ['diagramId'],
  },
} as const;
