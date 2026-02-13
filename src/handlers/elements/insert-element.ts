/**
 * Handler for insert_bpmn_element tool.
 *
 * Inserts a new element into an existing sequence flow, splitting the
 * flow and reconnecting automatically.  Accepts a flowId, elementType,
 * and optional name — a very common operation when modifying existing
 * diagrams.
 */

import { type ToolResult } from '../../types';
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
} from '../helpers';
import { STANDARD_BPMN_GAP, getElementSize } from '../../constants';
import { appendLintFeedback } from '../../linter';
import { resizeParentContainers } from './add-element-helpers';
import {
  detectOverlaps,
  resolveInsertionOverlaps,
  buildInsertResult,
} from './insert-element-helpers';
import { validateElementType, INSERTABLE_ELEMENT_TYPES } from '../element-type-validation';

export interface InsertElementArgs {
  diagramId: string;
  flowId: string;
  elementType: string;
  name?: string;
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

/** Shift downstream elements right when there isn't enough horizontal space. */
function shiftIfNeeded(
  elementRegistry: any,
  modeling: any,
  srcRight: number,
  tgtLeft: number,
  requiredSpace: number,
  sourceId: string
): number {
  const availableSpace = tgtLeft - srcRight;
  if (availableSpace >= requiredSpace) return 0;

  const shiftAmount = requiredSpace - availableSpace;
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
  if (toShift.length > 0) modeling.moveElements(toShift, { x: shiftAmount, y: 0 });
  resizeParentContainers(elementRegistry, modeling);
  return shiftAmount;
}

/** Reconnect source→newElement→target with new sequence flows. */
function reconnectThroughElement(
  modeling: any,
  elementRegistry: any,
  source: any,
  createdElement: any,
  target: any,
  elementName: string | undefined,
  flowCondition: any
): { conn1: any; conn2: any } {
  const flowId1 = generateFlowId(elementRegistry, source?.businessObject?.name, elementName);
  const conn1 = modeling.connect(source, createdElement, {
    type: 'bpmn:SequenceFlow',
    id: flowId1,
  });
  fixConnectionId(conn1, flowId1);
  if (flowCondition) {
    modeling.updateProperties(conn1, { conditionExpression: flowCondition });
  }

  const flowId2 = generateFlowId(elementRegistry, elementName, target?.businessObject?.name);
  const conn2 = modeling.connect(createdElement, target, {
    type: 'bpmn:SequenceFlow',
    id: flowId2,
  });
  fixConnectionId(conn2, flowId2);
  return { conn1, conn2 };
}

/** Compute the insertion midpoint between source right edge and target left edge. */
function computeInsertionMidpoint(
  source: any,
  target: any,
  newSize: { width: number; height: number }
): { midX: number; midY: number } {
  const srcRight = source.x + (source.width || 0);
  const tgtLeft = target.x;
  const srcCy = source.y + (source.height || 0) / 2;
  const tgtCy = target.y + (target.height || 0) / 2;
  return {
    midX: Math.round((srcRight + tgtLeft) / 2) - newSize.width / 2,
    midY: Math.round((srcCy + tgtCy) / 2) - newSize.height / 2,
  };
}

export async function handleInsertElement(args: InsertElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'flowId', 'elementType']);
  validateElementType(args.elementType, INSERTABLE_ELEMENT_TYPES);
  const { diagramId, flowId, elementType, name: elementName } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementFactory = diagram.modeler.get('elementFactory');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  const { flow, source, target } = validateInsertionArgs(elementRegistry, flowId, elementType);

  // Capture flow properties before deletion
  const flowLabel = flow.businessObject?.name;
  const flowCondition = flow.businessObject?.conditionExpression;
  const sourceId = source.id;
  const targetId = target.id;
  const newSize = getElementSize(elementType);
  const srcRight = source.x + (source.width || 0);
  const tgtLeft = target.x;
  const requiredSpace = STANDARD_BPMN_GAP + newSize.width + STANDARD_BPMN_GAP;

  // Step 1: Delete existing flow and shift if needed
  modeling.removeElements([flow]);
  const shiftApplied = shiftIfNeeded(
    elementRegistry,
    modeling,
    srcRight,
    tgtLeft,
    requiredSpace,
    sourceId
  );

  // Step 2: Calculate insertion position
  const updatedSource = elementRegistry.get(sourceId);
  const updatedTarget = elementRegistry.get(targetId);
  const { midX, midY } = computeInsertionMidpoint(updatedSource, updatedTarget, newSize);

  const descriptiveId = generateDescriptiveId(elementRegistry, elementType, elementName);
  const businessObject = createBusinessObject(diagram.modeler, elementType, descriptiveId);
  const shape = elementFactory.createShape({
    type: elementType,
    id: descriptiveId,
    businessObject,
  });

  const parent = updatedSource.parent;
  if (!parent) throw new McpError(ErrorCode.InternalError, 'Could not determine parent container');

  const createdElement = modeling.createShape(
    shape,
    { x: midX + newSize.width / 2, y: midY + newSize.height / 2 },
    parent
  );
  if (elementName) modeling.updateProperties(createdElement, { name: elementName });

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

  const overlaps = detectOverlaps(elementRegistry, createdElement);
  if (overlaps.length > 0) {
    resolveInsertionOverlaps(modeling, elementRegistry, createdElement, overlaps);
  }

  await syncXml(diagram);

  const result = jsonResult(
    buildInsertResult({
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
    })
  );
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
