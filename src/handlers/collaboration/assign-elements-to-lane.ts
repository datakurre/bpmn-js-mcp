/**
 * Internal handler behind create_bpmn_lanes's `assignments` form.
 *
 * Bulk-assigns multiple elements to a lane, updating their flowNodeRef
 * membership and optionally repositioning them vertically within the lane.
 */
// @mutating

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
import { removeFromAllLanes, addToLane } from '../lane-helpers';
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
  'bpmn:BoundaryEvent', // Boundary events must stay attached to their host
]);

/** Reposition an element vertically to center within lane bounds.
 *
 * Returns a warning string if the move triggers a docking error from
 * ManhattanLayout (i.e. when the element already has connected flows in
 * an inconsistent state), or undefined when the move succeeds silently.
 */
function repositionInLane(
  modeling: any,
  element: any,
  laneCenterY: number,
  laneTop: number,
  laneBottom: number
): string | undefined {
  const elCenterY = element.y + (element.height || 0) / 2;
  const halfH = (element.height || 0) / 2;
  const outsideLane = elCenterY - halfH < laneTop || elCenterY + halfH > laneBottom;
  if (!outsideLane) return undefined;
  const dy = laneCenterY - elCenterY;
  if (Math.abs(dy) > 0.5) {
    try {
      modeling.moveElements([element], { x: 0, y: dy });
    } catch (err: any) {
      // ManhattanLayout throws "unexpected dockingDirection: <undefined>" when
      // the element already has sequence-flow connections whose waypoints are
      // in an inconsistent state.  Degrade gracefully: skip the reposition and
      // return a warning so callers can surface it without crashing.
      return (
        `Could not reposition element "${element.id}" into lane ` +
        `(docking error: ${err?.message ?? String(err)}). ` +
        `Run layout_bpmn_diagram afterwards to correct positions.`
      );
    }
  }
  return undefined;
}

export interface LaneAssignmentOutcome {
  laneId: string;
  laneName: string;
  assigned: string[];
  skipped: Array<{ elementId: string; reason: string }>;
  repositionWarnings: string[];
}

/**
 * Assign elements to a lane without syncing XML or linting — callers that
 * batch several assignments sync and lint once for the whole call.
 */
export function applyLaneAssignment(
  diagram: any,
  laneId: string,
  elementIds: string[],
  reposition = true
): LaneAssignmentOutcome {
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
  const repositionWarnings: string[] = [];

  for (const elementId of elementIds) {
    const element = elementRegistry.get(elementId);
    if (!element) {
      skipped.push({ elementId, reason: 'Element not found' });
      continue;
    }
    if (NON_LANE_ASSIGNABLE.has(element.type || '')) {
      skipped.push({
        elementId,
        reason:
          element.type === 'bpmn:BoundaryEvent'
            ? 'Boundary events follow their host task automatically — assign the host task instead'
            : `${element.type} cannot be assigned to a lane`,
      });
      continue;
    }

    removeFromAllLanes(elementRegistry, element.businessObject);
    addToLane(lane, element.businessObject);
    if (reposition) {
      const warn = repositionInLane(modeling, element, laneCenterY, laneTop, laneBottom);
      if (warn) repositionWarnings.push(warn);
    }
    assigned.push(elementId);

    // Automatically move attached boundary events with their host task
    const attachedBoundary = elementRegistry.filter(
      (el: any) => el.type === 'bpmn:BoundaryEvent' && el.host?.id === elementId
    );
    for (const be of attachedBoundary) {
      removeFromAllLanes(elementRegistry, be.businessObject);
      addToLane(lane, be.businessObject);
      // Boundary events follow their host position — no explicit repositioning needed
    }
  }

  return {
    laneId,
    laneName: lane.businessObject?.name || laneId,
    assigned,
    skipped,
    repositionWarnings,
  };
}

export async function handleAssignElementsToLane(
  args: AssignElementsToLaneArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'laneId', 'elementIds']);
  const { diagramId, laneId, elementIds, reposition = true } = args;

  const diagram = requireDiagram(diagramId);
  const { laneName, assigned, skipped, repositionWarnings } = applyLaneAssignment(
    diagram,
    laneId,
    elementIds,
    reposition
  );

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    laneId,
    laneName,
    assignedCount: assigned.length,
    assignedElementIds: assigned,
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(repositionWarnings.length > 0 ? { repositionWarnings } : {}),
    message: `Assigned ${assigned.length} element(s) to lane "${laneName}"${skipped.length > 0 ? ` (${skipped.length} skipped)` : ''}`,
    nextSteps: [
      {
        tool: 'layout_bpmn_diagram',
        description: 'Re-layout the diagram to position elements within their lanes.',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}
