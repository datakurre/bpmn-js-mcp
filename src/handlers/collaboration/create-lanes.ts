/**
 * Handler for create_bpmn_lanes tool.
 *
 * Creates a bpmn:LaneSet with multiple bpmn:Lane elements inside a
 * participant pool.  Each lane gets proper DI bounds and is sized to
 * divide the pool height evenly (or as specified).
 */

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

export interface CreateLanesArgs {
  diagramId: string;
  /** The participant (pool) to add lanes to. */
  participantId: string;
  /** Lane definitions — at least 2 lanes required. */
  lanes: Array<{
    name: string;
    /** Optional explicit height (px). If omitted, pool height is divided evenly. */
    height?: number;
  }>;
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
  lanes: CreateLanesArgs['lanes']
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

export async function handleCreateLanes(args: CreateLanesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'participantId', 'lanes']);
  const { diagramId, participantId, lanes } = args;

  if (!lanes || lanes.length < 2) {
    throw missingRequiredError(['lanes (at least 2 lanes required)']);
  }

  const diagram = requireDiagram(diagramId);
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const participant = requireElement(elementRegistry, participantId);
  if (participant.type !== 'bpmn:Participant') {
    throw typeMismatchError(participantId, participant.type, ['bpmn:Participant']);
  }

  const poolX = participant.x;
  const poolY = participant.y;
  const poolWidth = participant.width || 600;
  const poolHeight = participant.height || 250;
  const geometry = computeLaneGeometry(poolX, poolWidth, poolHeight, lanes);

  // Resize pool if lanes exceed its height
  if (geometry.totalLaneHeight > poolHeight) {
    modeling.resizeShape(participant, {
      x: poolX,
      y: poolY,
      width: poolWidth,
      height: geometry.totalLaneHeight,
    });
  }

  const createdIds: string[] = [];
  let currentY = poolY;
  for (const laneDef of lanes) {
    createdIds.push(createSingleLane(diagram, participant, laneDef, geometry, currentY));
    currentY += laneDef.height || geometry.autoHeight;
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    participantId,
    laneIds: createdIds,
    laneCount: createdIds.length,
    message: `Created ${createdIds.length} lanes in participant ${participantId}: ${createdIds.join(', ')}`,
    nextSteps: [
      {
        tool: 'add_bpmn_element',
        description:
          'Add elements to a specific lane using the laneId parameter for automatic vertical centering',
      },
      {
        tool: 'move_bpmn_element',
        description: 'Move existing elements into lanes using the laneId parameter',
      },
      {
        tool: 'assign_bpmn_elements_to_lane',
        description: 'Bulk-assign multiple existing elements to a lane',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'create_bpmn_lanes',
  description:
    'Create lanes (swimlanes) within a participant pool. Creates a bpmn:LaneSet with ' +
    'the specified lanes, dividing the pool height evenly (or using explicit heights). ' +
    'Lanes represent roles or departments within a single organization/process. ' +
    'Use lanes for role separation within one pool; use separate pools (participants) ' +
    'for separate organizations with message flows. Requires at least 2 lanes.',
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
        description: 'Lane definitions (at least 2)',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Lane name (typically a role or department)' },
            height: {
              type: 'number',
              description:
                'Optional lane height in pixels. If omitted, the pool height is divided evenly among lanes without explicit heights.',
            },
          },
          required: ['name'],
        },
        minItems: 2,
      },
    },
    required: ['diagramId', 'participantId', 'lanes'],
  },
} as const;
