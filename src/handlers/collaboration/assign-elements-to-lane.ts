/**
 * Handler for assign_bpmn_elements_to_lane tool.
 *
 * Bulk-assigns multiple elements to a lane, updating their flowNodeRef
 * membership and optionally repositioning them vertically within the lane.
 */

import { type ToolResult } from '../../types';
import { typeMismatchError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface AssignElementsToLaneArgs {
  diagramId: string;
  /** Target lane ID. */
  laneId: string;
  /** Element IDs to assign to the lane. */
  elementIds: string[];
  /** When true (default), reposition elements vertically within lane bounds. */
  reposition?: boolean;
}

/** Element types that cannot be assigned to lanes. */
const NON_LANE_ASSIGNABLE = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:Process',
  'bpmn:Collaboration',
]);

/** Remove an element's business object from all lanes' flowNodeRef lists. */
function removeFromAllLanes(elementRegistry: any, elementBo: any): void {
  const allLanes = elementRegistry.filter((el: any) => el.type === 'bpmn:Lane');
  for (const existingLane of allLanes) {
    const refs = existingLane.businessObject?.flowNodeRef;
    if (Array.isArray(refs)) {
      const idx = refs.indexOf(elementBo);
      if (idx >= 0) refs.splice(idx, 1);
    }
  }
}

/** Add an element's business object to a lane's flowNodeRef list. */
function addToLane(lane: any, elementBo: any): void {
  const laneBo = lane.businessObject;
  if (!laneBo) return;
  const refs: unknown[] = (laneBo.flowNodeRef as unknown[] | undefined) || [];
  if (!laneBo.flowNodeRef) laneBo.flowNodeRef = refs;
  if (!refs.includes(elementBo)) refs.push(elementBo);
}

/** Reposition an element vertically to center within lane bounds. */
function repositionInLane(
  modeling: any,
  element: any,
  laneCenterY: number,
  laneTop: number,
  laneBottom: number
): void {
  const elCenterY = element.y + (element.height || 0) / 2;
  const halfH = (element.height || 0) / 2;
  const outsideLane = elCenterY - halfH < laneTop || elCenterY + halfH > laneBottom;
  if (!outsideLane) return;
  const dy = laneCenterY - elCenterY;
  if (Math.abs(dy) > 0.5) {
    modeling.moveElements([element], { x: 0, y: dy });
  }
}

export async function handleAssignElementsToLane(
  args: AssignElementsToLaneArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'laneId', 'elementIds']);
  const { diagramId, laneId, elementIds, reposition = true } = args;

  const diagram = requireDiagram(diagramId);
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const lane = requireElement(elementRegistry, laneId);
  if (lane.type !== 'bpmn:Lane') {
    throw typeMismatchError(laneId, lane.type, ['bpmn:Lane']);
  }

  const laneTop = lane.y;
  const laneBottom = lane.y + (lane.height || 0);
  const laneCenterY = lane.y + (lane.height || 0) / 2;

  const assigned: string[] = [];
  const skipped: Array<{ elementId: string; reason: string }> = [];

  for (const elementId of elementIds) {
    const element = elementRegistry.get(elementId);
    if (!element) {
      skipped.push({ elementId, reason: 'Element not found' });
      continue;
    }
    if (NON_LANE_ASSIGNABLE.has(element.type || '')) {
      skipped.push({ elementId, reason: `${element.type} cannot be assigned to a lane` });
      continue;
    }

    removeFromAllLanes(elementRegistry, element.businessObject);
    addToLane(lane, element.businessObject);
    if (reposition) repositionInLane(modeling, element, laneCenterY, laneTop, laneBottom);
    assigned.push(elementId);
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    laneId,
    laneName: lane.businessObject?.name || laneId,
    assignedCount: assigned.length,
    assignedElementIds: assigned,
    ...(skipped.length > 0 ? { skipped } : {}),
    message: `Assigned ${assigned.length} element(s) to lane "${lane.businessObject?.name || laneId}"${skipped.length > 0 ? ` (${skipped.length} skipped)` : ''}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'assign_bpmn_elements_to_lane',
  description:
    "Bulk-assign multiple elements to a lane. Updates the lane's flowNodeRef membership " +
    'and optionally repositions elements vertically within the lane bounds. ' +
    'Elements are removed from any previous lane assignment. ' +
    'Participants, lanes, processes, and collaborations cannot be assigned to lanes.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      laneId: { type: 'string', description: 'The ID of the target lane' },
      elementIds: {
        type: 'array',
        description: 'Array of element IDs to assign to the lane',
        items: { type: 'string' },
        minItems: 1,
      },
      reposition: {
        type: 'boolean',
        description:
          'When true (default), repositions elements vertically to center them within the lane bounds. ' +
          'Set to false to keep elements at their current position and only update the lane membership.',
      },
    },
    required: ['diagramId', 'laneId', 'elementIds'],
  },
} as const;
