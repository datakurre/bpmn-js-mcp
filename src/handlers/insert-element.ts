/**
 * Handler for insert_bpmn_element tool.
 *
 * Inserts a new element into an existing sequence flow, splitting the
 * flow and reconnecting automatically.  Accepts a flowId, elementType,
 * and optional name — a very common operation when modifying existing
 * diagrams.
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  generateFlowId,
  validateArgs,
  getVisibleElements,
  createBusinessObject,
  fixConnectionId,
  resizeParentContainers,
  buildElementCounts,
} from './helpers';
import { STANDARD_BPMN_GAP, getElementSize } from '../constants';
import { appendLintFeedback } from '../linter';

// ── Overlap detection & resolution for post-insertion cleanup ─────────────

/**
 * Detect elements that overlap with the newly inserted element.
 * Returns pairs [overlappingElement, insertedElement].
 */
function detectOverlaps(elementRegistry: any, inserted: any): any[] {
  const elements = elementRegistry.filter(
    (el: any) =>
      el.id !== inserted.id &&
      el.type &&
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.type !== 'bpmn:Process' &&
      el.type !== 'bpmn:Collaboration' &&
      el.type !== 'label' &&
      !el.type.includes('BPMNDiagram') &&
      !el.type.includes('BPMNPlane') &&
      // Skip parent-child relationships
      el.parent !== inserted &&
      inserted.parent !== el
  );

  const ix = inserted.x ?? 0;
  const iy = inserted.y ?? 0;
  const iw = inserted.width ?? 0;
  const ih = inserted.height ?? 0;

  return elements.filter((el: any) => {
    const ex = el.x ?? 0;
    const ey = el.y ?? 0;
    const ew = el.width ?? 0;
    const eh = el.height ?? 0;
    return ix < ex + ew && ix + iw > ex && iy < ey + eh && iy + ih > ey;
  });
}

/**
 * Resolve overlaps by shifting the overlapping elements vertically.
 * Uses a simple heuristic: move the non-inserted element down by the
 * overlap amount plus a standard gap.
 */
function resolveInsertionOverlaps(
  modeling: any,
  _elementRegistry: any,
  inserted: any,
  overlapping: any[]
): void {
  const iy = inserted.y ?? 0;
  const ih = inserted.height ?? 0;
  const insertedBottom = iy + ih;

  for (const el of overlapping) {
    const ey = el.y ?? 0;
    // Calculate how much we need to shift to clear the overlap
    const overlap = insertedBottom - ey + STANDARD_BPMN_GAP;
    if (overlap > 0) {
      // Collect the element and its connected downstream elements on same branch
      modeling.moveElements([el], { x: 0, y: overlap });
      // Also move boundary events attached to this element
      if (el.attachers) {
        for (const attacher of el.attachers) {
          modeling.moveElements([attacher], { x: 0, y: overlap });
        }
      }
    }
  }
}

export interface InsertElementArgs {
  diagramId: string;
  flowId: string;
  elementType: string;
  name?: string;
}

export async function handleInsertElement(args: InsertElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'flowId', 'elementType']);
  const { diagramId, flowId, elementType, name: elementName } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementFactory = diagram.modeler.get('elementFactory');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  // Validate the flow exists and is a sequence flow
  const flow = requireElement(elementRegistry, flowId);
  const flowType = flow.type || flow.businessObject?.$type || '';
  if (!flowType.includes('SequenceFlow')) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Element ${flowId} is not a SequenceFlow (got: ${flowType}). ` +
        'insert_bpmn_element only works with sequence flows.'
    );
  }

  const source = flow.source;
  const target = flow.target;
  if (!source || !target) {
    throw new McpError(ErrorCode.InvalidRequest, `Flow ${flowId} has no source or target element`);
  }

  // Validate element type is insertable (not a participant, lane, etc.)
  const nonInsertable = new Set([
    'bpmn:Participant',
    'bpmn:Lane',
    'bpmn:BoundaryEvent',
    'bpmn:TextAnnotation',
    'bpmn:DataObjectReference',
    'bpmn:DataStoreReference',
    'bpmn:Group',
  ]);
  if (nonInsertable.has(elementType)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Cannot insert ${elementType} into a sequence flow. ` +
        'Only tasks, events, gateways, subprocesses, and call activities can be inserted.'
    );
  }

  // Capture flow properties before deletion
  const flowLabel = flow.businessObject?.name;
  const flowCondition = flow.businessObject?.conditionExpression;
  const sourceId = source.id;
  const targetId = target.id;

  // Compute source/target geometry
  const newSize = getElementSize(elementType);
  const srcRight = source.x + (source.width || 0);
  const tgtLeft = target.x;

  // Check horizontal space — shift downstream elements if needed
  const requiredSpace = STANDARD_BPMN_GAP + newSize.width + STANDARD_BPMN_GAP;
  const availableSpace = tgtLeft - srcRight;
  let shiftApplied = 0;

  // Step 1: Delete the existing flow
  modeling.removeElements([flow]);

  // Step 1b: Shift downstream elements right when space is insufficient
  if (availableSpace < requiredSpace) {
    shiftApplied = requiredSpace - availableSpace;
    const toShift = getVisibleElements(elementRegistry).filter(
      (el: any) =>
        !el.type.includes('SequenceFlow') &&
        !el.type.includes('MessageFlow') &&
        !el.type.includes('Association') &&
        el.type !== 'bpmn:Participant' &&
        el.type !== 'bpmn:Lane' &&
        el.id !== sourceId &&
        el.x >= tgtLeft
    );
    if (toShift.length > 0) {
      modeling.moveElements(toShift, { x: shiftApplied, y: 0 });
    }
    resizeParentContainers(elementRegistry, modeling);
  }

  // Step 2: Calculate insertion position (center of the gap)
  const updatedSource = elementRegistry.get(sourceId);
  const updatedTarget = elementRegistry.get(targetId);
  const updSrcRight = updatedSource.x + (updatedSource.width || 0);
  const updTgtLeft = updatedTarget.x;
  const updSrcCy = updatedSource.y + (updatedSource.height || 0) / 2;
  const updTgtCy = updatedTarget.y + (updatedTarget.height || 0) / 2;
  const gapCenterX = Math.round((updSrcRight + updTgtLeft) / 2);
  const flowCenterY = Math.round((updSrcCy + updTgtCy) / 2);
  const midX = gapCenterX - newSize.width / 2;
  const midY = flowCenterY - newSize.height / 2;

  // Step 3: Create the new element with a matching business-object ID
  const descriptiveId = generateDescriptiveId(elementRegistry, elementType, elementName);
  const businessObject = createBusinessObject(diagram.modeler, elementType, descriptiveId);
  const shapeOpts: Record<string, any> = {
    type: elementType,
    id: descriptiveId,
    businessObject,
  };
  const shape = elementFactory.createShape(shapeOpts);

  // Find the parent container (same as the source element's parent)
  const parent = updatedSource.parent;
  if (!parent) {
    throw new McpError(ErrorCode.InternalError, 'Could not determine parent container');
  }

  const createdElement = modeling.createShape(
    shape,
    { x: midX + newSize.width / 2, y: midY + newSize.height / 2 },
    parent
  );

  if (elementName) {
    modeling.updateProperties(createdElement, { name: elementName });
  }

  // Step 4: Connect source → new element
  const flowId1 = generateFlowId(elementRegistry, updatedSource?.businessObject?.name, elementName);
  const conn1 = modeling.connect(updatedSource, createdElement, {
    type: 'bpmn:SequenceFlow',
    id: flowId1,
  });
  fixConnectionId(conn1, flowId1);

  // If the original flow had a condition, move it to the source→new flow
  if (flowCondition) {
    modeling.updateProperties(conn1, { conditionExpression: flowCondition });
  }

  // Step 5: Connect new element → target
  const flowId2 = generateFlowId(elementRegistry, elementName, updatedTarget?.businessObject?.name);
  const conn2 = modeling.connect(createdElement, updatedTarget, {
    type: 'bpmn:SequenceFlow',
    id: flowId2,
  });
  fixConnectionId(conn2, flowId2);

  // Step 6: Detect and fix overlaps caused by insertion/shift
  const overlaps = detectOverlaps(elementRegistry, createdElement);
  if (overlaps.length > 0) {
    resolveInsertionOverlaps(modeling, elementRegistry, createdElement, overlaps);
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId: createdElement.id,
    elementType,
    name: elementName,
    position: { x: midX, y: midY },
    replacedFlowId: flowId,
    newFlows: [
      { flowId: conn1.id, source: sourceId, target: createdElement.id },
      { flowId: conn2.id, source: createdElement.id, target: targetId },
    ],
    ...(shiftApplied > 0
      ? { shiftApplied, shiftNote: 'Downstream elements shifted right to make space' }
      : {}),
    diagramCounts: buildElementCounts(elementRegistry),
    ...(overlaps.length > 0
      ? {
          overlapResolution: `Resolved ${overlaps.length} overlap(s) by shifting elements: ${overlaps.map((el: any) => el.id).join(', ')}`,
        }
      : {}),
    message: `Inserted ${elementType}${elementName ? ` "${elementName}"` : ''} between ${sourceId} and ${targetId}`,
    ...(flowLabel ? { note: `Original flow label "${flowLabel}" was removed` } : {}),
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'insert_bpmn_element',
  description:
    'Insert a new element into an existing sequence flow, splitting the flow and reconnecting automatically. ' +
    'Accepts a flowId to split, the elementType to insert, and an optional name. ' +
    "The new element is positioned at the midpoint between the flow's source and target. " +
    'This is a common operation when modifying existing diagrams — it replaces the 3-step ' +
    'pattern of delete flow → add element → create two new flows.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      flowId: {
        type: 'string',
        description: 'The ID of the sequence flow to split',
      },
      elementType: {
        type: 'string',
        enum: [
          'bpmn:Task',
          'bpmn:UserTask',
          'bpmn:ServiceTask',
          'bpmn:ScriptTask',
          'bpmn:ManualTask',
          'bpmn:BusinessRuleTask',
          'bpmn:SendTask',
          'bpmn:ReceiveTask',
          'bpmn:CallActivity',
          'bpmn:ExclusiveGateway',
          'bpmn:ParallelGateway',
          'bpmn:InclusiveGateway',
          'bpmn:EventBasedGateway',
          'bpmn:IntermediateCatchEvent',
          'bpmn:IntermediateThrowEvent',
          'bpmn:SubProcess',
          'bpmn:StartEvent',
          'bpmn:EndEvent',
        ],
        description: 'The type of BPMN element to insert',
      },
      name: {
        type: 'string',
        description: 'The name/label for the inserted element',
      },
    },
    required: ['diagramId', 'flowId', 'elementType'],
  },
} as const;
