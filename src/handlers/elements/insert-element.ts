/**
 * Handler for insert_bpmn_element tool.
 *
 * Inserts a new element into an existing sequence flow, splitting the
 * flow and reconnecting automatically.  Accepts a flowId, elementType,
 * and optional name — a very common operation when modifying existing
 * diagrams.
 */
// @mutating

import { type ToolResult } from '../../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  validateArgs,
  createBusinessObject,
  typeMismatchError,
  getService,
} from '../helpers';
import { STANDARD_BPMN_GAP, ELK_LAYER_SPACING, getElementSize } from '../../constants';
import { appendLintFeedback } from '../../linter';
import {
  buildInsertResult,
  shiftIfNeeded,
  reconnectThroughElement,
  postInsertCleanup,
} from './insert-element-helpers';
import { validateElementType, INSERTABLE_ELEMENT_TYPES } from '../element-type-validation';

export interface InsertElementArgs {
  diagramId: string;
  flowId: string;
  elementType: string;
  name?: string;
  /** Override automatic Y positioning by centering the element in the specified lane. */
  laneId?: string;
}

const NON_INSERTABLE_TYPES = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:BoundaryEvent',
  'bpmn:TextAnnotation',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:Group',
]);

/** Validate the flow and element type, returning source/target info. */
function validateInsertionArgs(
  elementRegistry: any,
  flowId: string,
  elementType: string
): { flow: any; source: any; target: any } {
  const flow = requireElement(elementRegistry, flowId);
  const flowType = flow.type || flow.businessObject?.$type || '';
  if (!flowType.includes('SequenceFlow')) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Element ${flowId} is not a SequenceFlow (got: ${flowType}). ` +
        'insert_bpmn_element only works with sequence flows.'
    );
  }
  if (!flow.source || !flow.target) {
    throw new McpError(ErrorCode.InvalidRequest, `Flow ${flowId} has no source or target element`);
  }
  if (NON_INSERTABLE_TYPES.has(elementType)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Cannot insert ${elementType} into a sequence flow. ` +
        'Only tasks, events, gateways, subprocesses, and call activities can be inserted.'
    );
  }
  return { flow, source: flow.source, target: flow.target };
}

/** Compute the insertion midpoint between source right edge and target left edge. */
/** Tolerance in pixels: source and target are considered "aligned" if their centers differ by less than this. */
const ALIGNMENT_TOLERANCE = 15;

function computeInsertionMidpoint(
  source: any,
  target: any,
  newSize: { width: number; height: number }
): { midX: number; midY: number } {
  const srcRight = source.x + (source.width || 0);
  const tgtLeft = target.x;
  const srcCy = source.y + (source.height || 0) / 2;
  const tgtCy = target.y + (target.height || 0) / 2;

  // When source and target are approximately aligned vertically,
  // preserve the alignment instead of averaging (avoids micro-offsets
  // that break straight horizontal flows, especially for gateways).
  const midY =
    Math.abs(srcCy - tgtCy) <= ALIGNMENT_TOLERANCE
      ? srcCy - newSize.height / 2
      : Math.round((srcCy + tgtCy) / 2) - newSize.height / 2;

  return {
    midX: Math.round((srcRight + tgtLeft) / 2) - newSize.width / 2,
    midY,
  };
}

/**
 * Resolve Y position and optional lane assignment.
 * If laneId is provided, centers the element vertically in that lane.
 * If no laneId and the flow crosses lanes, defaults to the source element's lane
 * (avoids inserting into an unrelated middle lane at the geometric midpoint).
 * Otherwise, uses the default midpoint Y.
 */
function resolveLanePlacement(
  elementRegistry: any,
  source: any,
  midY: number,
  halfHeight: number,
  laneId?: string
): { insertY: number; assignedLaneId?: string; autoLaneHint?: string } {
  if (laneId) {
    const targetLane = requireElement(elementRegistry, laneId);
    if (targetLane.type !== 'bpmn:Lane') {
      throw typeMismatchError(laneId, targetLane.type, ['bpmn:Lane']);
    }
    return {
      insertY: targetLane.y + (targetLane.height || 0) / 2,
      assignedLaneId: laneId,
    };
  }

  // Auto-detect: if the source element is inside a lane, prefer that lane
  // over the raw midpoint (which may land in an unrelated lane for cross-lane flows)
  const lanes = elementRegistry.filter((el: any) => el.type === 'bpmn:Lane');
  if (lanes.length > 0) {
    const sourceCy = source.y + (source.height || 0) / 2;
    const sourceLane = lanes.find((lane: any) => {
      const ly = lane.y ?? 0;
      const lh = lane.height ?? 0;
      return sourceCy >= ly && sourceCy <= ly + lh;
    });
    if (sourceLane) {
      const laneCy = sourceLane.y + (sourceLane.height || 0) / 2;
      // Only override if midpoint would land in a different lane
      const midpointLane = lanes.find((lane: any) => {
        const ly = lane.y ?? 0;
        const lh = lane.height ?? 0;
        return midY + halfHeight >= ly && midY + halfHeight <= ly + lh;
      });
      if (!midpointLane || midpointLane.id !== sourceLane.id) {
        return {
          insertY: laneCy,
          assignedLaneId: sourceLane.id,
          autoLaneHint:
            `Element auto-placed in source lane "${sourceLane.businessObject?.name || sourceLane.id}" ` +
            'instead of geometric midpoint (cross-lane flow detected). ' +
            'Use laneId parameter to override.',
        };
      }
    }
  }

  return { insertY: midY + halfHeight };
}

/** Register element in lane's flowNodeRef list. */
function assignToLane(elementRegistry: any, laneId: string, createdElement: any): void {
  const targetLane = elementRegistry.get(laneId);
  if (!targetLane?.businessObject) return;
  const refs: unknown[] = (targetLane.businessObject.flowNodeRef as unknown[] | undefined) || [];
  if (!targetLane.businessObject.flowNodeRef) {
    targetLane.businessObject.flowNodeRef = refs;
  }
  const elemBo = createdElement.businessObject;
  if (elemBo && !refs.includes(elemBo)) {
    refs.push(elemBo);
  }
}

/** Create and place the new element shape at the computed insertion point. */
function createInsertedShape(opts: {
  diagram: any;
  elementType: string;
  elementName?: string;
  midX: number;
  midY: number;
  newSize: { width: number; height: number };
  parent: any;
  laneId?: string;
  source: any;
}): { createdElement: any; assignedLaneId?: string; autoLaneHint?: string } {
  const { diagram, elementType, elementName, midX, midY, newSize, parent, laneId, source } = opts;
  const modeling = getService(diagram.modeler, 'modeling');
  const elementFactory = getService(diagram.modeler, 'elementFactory');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const descriptiveId = generateDescriptiveId(elementRegistry, elementType, elementName);
  const businessObject = createBusinessObject(diagram.modeler, elementType, descriptiveId);
  const shape = elementFactory.createShape({
    type: elementType,
    id: descriptiveId,
    businessObject,
  });

  const { insertY, assignedLaneId, autoLaneHint } = resolveLanePlacement(
    elementRegistry,
    source,
    midY,
    newSize.height / 2,
    laneId
  );

  const createdElement = modeling.createShape(
    shape,
    { x: midX + newSize.width / 2, y: insertY },
    parent
  );
  if (elementName) modeling.updateProperties(createdElement, { name: elementName });

  if (assignedLaneId) {
    assignToLane(elementRegistry, assignedLaneId, createdElement);
  }

  return { createdElement, assignedLaneId, autoLaneHint };
}

/** Capture flow properties, remove the flow, and shift downstream elements if needed. */
function deleteFlowAndShift(
  diagram: ReturnType<typeof requireDiagram>,
  flow: any,
  source: any,
  target: any,
  newSize: { width: number; height: number }
) {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const flowLabel = flow.businessObject?.name;
  const flowCondition = flow.businessObject?.conditionExpression;
  const sourceId = source.id;
  const targetId = target.id;
  const srcRight = source.x + (source.width || 0);
  const tgtLeft = target.x;
  // C1-2: Use ELK_LAYER_SPACING (the inter-layer gap that full layout produces)
  // plus STANDARD_BPMN_GAP on the far side.  This makes the insert shift
  // consistent with what layout_bpmn_diagram would place, reducing the need
  // for a full re-layout after insertion.
  const requiredSpace = ELK_LAYER_SPACING + newSize.width + STANDARD_BPMN_GAP;

  modeling.removeElements([flow]);
  // C1-1: Pass the target element so shiftIfNeeded can BFS-walk downstream,
  // avoiding shifts of unrelated parallel branches.
  const shiftApplied = shiftIfNeeded(
    elementRegistry,
    modeling,
    srcRight,
    tgtLeft,
    requiredSpace,
    sourceId,
    target
  );

  const updatedSource = elementRegistry.get(sourceId);
  const updatedTarget = elementRegistry.get(targetId);
  if (!updatedSource || !updatedTarget) {
    throw new McpError(
      ErrorCode.InternalError,
      'Source or target element not found after flow deletion'
    );
  }

  return {
    flowLabel,
    flowCondition,
    sourceId,
    targetId,
    shiftApplied,
    updatedSource,
    updatedTarget,
  };
}

export async function handleInsertElement(args: InsertElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'flowId', 'elementType']);
  validateElementType(args.elementType, INSERTABLE_ELEMENT_TYPES);
  const { diagramId, flowId, elementType, name: elementName } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const { flow, source, target } = validateInsertionArgs(elementRegistry, flowId, elementType);
  const newSize = getElementSize(elementType);

  // Step 1: Delete existing flow and shift if needed
  const {
    flowLabel,
    flowCondition,
    sourceId,
    targetId,
    shiftApplied,
    updatedSource,
    updatedTarget,
  } = deleteFlowAndShift(diagram, flow, source, target, newSize);

  // Step 2: Calculate insertion position
  const { midX, midY } = computeInsertionMidpoint(updatedSource, updatedTarget, newSize);

  const parent = updatedSource.parent;
  if (!parent) throw new McpError(ErrorCode.InternalError, 'Could not determine parent container');

  const { createdElement, assignedLaneId, autoLaneHint } = createInsertedShape({
    diagram,
    elementType,
    elementName,
    midX,
    midY,
    newSize,
    parent,
    laneId: args.laneId,
    source: updatedSource,
  });

  // Step 4: Reconnect
  const { conn1, conn2 } = reconnectThroughElement(
    modeling,
    elementRegistry,
    updatedSource,
    createdElement,
    updatedTarget,
    elementName,
    flowCondition
  );

  // C1-3/C1-4: Set clean waypoints and adjust labels (extracted helper).
  const overlaps = await postInsertCleanup({
    modeling,
    elementRegistry,
    diagram,
    source: updatedSource,
    inserted: createdElement,
    target: updatedTarget,
    conn1,
    conn2,
    alignmentTolerance: ALIGNMENT_TOLERANCE,
  });

  await syncXml(diagram);

  const resultData = buildInsertResult({
    createdElement,
    elementType,
    elementName,
    midX,
    midY,
    flowId,
    conn1,
    conn2,
    sourceId,
    targetId,
    shiftApplied,
    overlaps,
    flowLabel,
    elementRegistry,
    laneId: assignedLaneId,
  });
  if (autoLaneHint) {
    resultData.autoLaneHint = autoLaneHint;
  }
  const result = jsonResult(resultData);
  return appendLintFeedback(result, diagram);
}

export { TOOL_DEFINITION } from './insert-element-schema';
