/**
 * Handler for move_to_lane tool.
 *
 * Moves an existing element into or out of a lane within a pool.
 */

import { type MoveToLaneArgs, type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from './helpers';
import { appendLintFeedback } from '../linter';

export async function handleMoveToLane(args: MoveToLaneArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'laneId']);
  const { diagramId, elementId, laneId } = args;
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

  // Cannot move infrastructure elements into lanes
  const elType = element.type || '';
  if (
    elType === 'bpmn:Participant' ||
    elType === 'bpmn:Lane' ||
    elType === 'bpmn:Process' ||
    elType === 'bpmn:Collaboration'
  ) {
    throw new McpError(ErrorCode.InvalidRequest, `Cannot move ${elType} into a lane`);
  }

  // Move the element to the centre of the target lane
  const laneCy = lane.y + (lane.height || 0) / 2;
  const elCy = element.y + (element.height || 0) / 2;

  // Only move vertically into the lane if the element is outside its Y bounds
  const laneTop = lane.y;
  const laneBottom = lane.y + (lane.height || 0);
  const halfH = (element.height || 0) / 2;

  let targetY = elCy;
  if (elCy - halfH < laneTop || elCy + halfH > laneBottom) {
    targetY = laneCy;
  }

  const dx = 0; // Keep X position by default
  const dy = targetY - elCy;

  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    modeling.moveElements([element], { x: dx, y: dy });
  }

  // Update the lane's flowNodeRef to include this element
  // bpmn-js handles lane membership based on spatial containment,
  // but we can also explicitly add to the lane's business object
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

export const TOOL_DEFINITION = {
  name: 'move_to_bpmn_lane',
  description:
    "Move an existing element into a lane. Adjusts the element's vertical position to fit within the lane bounds and updates lane membership.",
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
      elementId: {
        type: 'string',
        description: 'The ID of the element to move into the lane',
      },
      laneId: {
        type: 'string',
        description: 'The ID of the target lane',
      },
    },
    required: ['diagramId', 'elementId', 'laneId'],
  },
} as const;
