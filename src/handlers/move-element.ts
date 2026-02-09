/**
 * Handler for move_bpmn_element tool.
 *
 * Merges the former move_bpmn_element and move_to_bpmn_lane tools.
 * When `laneId` is provided, handles lane membership and auto-centering.
 */

import { type MoveElementArgs, type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from './helpers';
import { appendLintFeedback } from '../linter';

export async function handleMoveElement(args: MoveElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId } = args;
  const laneId = (args as any).laneId as string | undefined;
  const x = args.x;
  const y = args.y;

  // Lane mode
  if (laneId) {
    return handleMoveToLane(diagramId, elementId, laneId);
  }

  // Position mode requires x and y
  if (x === undefined || y === undefined) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Either x/y coordinates or laneId must be provided'
    );
  }

  const diagram = requireDiagram(diagramId);
  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  const element = requireElement(elementRegistry, elementId);
  const deltaX = x - element.x;
  const deltaY = y - element.y;
  modeling.moveElements([element], { x: deltaX, y: deltaY });

  await syncXml(diagram);

  return jsonResult({
    success: true,
    elementId,
    position: { x, y },
    message: `Moved element ${elementId} to (${x}, ${y})`,
  });
}

/**
 * Move an element into a lane (former move_to_bpmn_lane).
 */
// eslint-disable-next-line complexity
async function handleMoveToLane(
  diagramId: string,
  elementId: string,
  laneId: string
): Promise<ToolResult> {
  const diagram = requireDiagram(diagramId);
  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  const element = requireElement(elementRegistry, elementId);
  const lane = requireElement(elementRegistry, laneId);

  if (lane.type !== 'bpmn:Lane') {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Target element ${laneId} is not a Lane (got: ${lane.type})`
    );
  }

  const elType = element.type || '';
  if (
    elType === 'bpmn:Participant' ||
    elType === 'bpmn:Lane' ||
    elType === 'bpmn:Process' ||
    elType === 'bpmn:Collaboration'
  ) {
    throw new McpError(ErrorCode.InvalidRequest, `Cannot move ${elType} into a lane`);
  }

  const laneCy = lane.y + (lane.height || 0) / 2;
  const elCy = element.y + (element.height || 0) / 2;

  const laneTop = lane.y;
  const laneBottom = lane.y + (lane.height || 0);
  const halfH = (element.height || 0) / 2;

  let targetY = elCy;
  if (elCy - halfH < laneTop || elCy + halfH > laneBottom) {
    targetY = laneCy;
  }

  const dx = 0;
  const dy = targetY - elCy;

  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    modeling.moveElements([element], { x: dx, y: dy });
  }

  const laneBo = lane.businessObject;
  if (laneBo) {
    const flowNodeRefs = laneBo.flowNodeRef || (laneBo.flowNodeRef = []);
    const elemBo = element.businessObject;
    if (elemBo && !flowNodeRefs.includes(elemBo)) {
      flowNodeRefs.push(elemBo);
    }
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    laneId,
    message: `Moved ${elementId} into lane ${laneBo?.name || laneId}`,
  });
  return appendLintFeedback(result, diagram);
}

// Backward-compatible alias
export { handleMoveElement as handleMoveToLane };

export const TOOL_DEFINITION = {
  name: 'move_bpmn_element',
  description:
    'Move an element to a new position in the diagram, or into a lane. When x/y are provided, moves to absolute coordinates. When laneId is provided, moves the element into the specified lane with auto-centering.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to move',
      },
      x: {
        type: 'number',
        description: 'New X coordinate (absolute position). Required unless laneId is provided.',
      },
      y: {
        type: 'number',
        description: 'New Y coordinate (absolute position). Required unless laneId is provided.',
      },
      laneId: {
        type: 'string',
        description:
          'ID of the target lane to move the element into. When provided, x/y are ignored and the element is auto-centered in the lane.',
      },
    },
    required: ['diagramId', 'elementId'],
  },
} as const;
