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
} from './helpers';
import { getElementSize } from '../constants';
import { appendLintFeedback } from '../linter';

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

  // Compute insertion position: midpoint between source and target
  const srcCx = source.x + (source.width || 0) / 2;
  const srcCy = source.y + (source.height || 0) / 2;
  const tgtCx = target.x + (target.width || 0) / 2;
  const tgtCy = target.y + (target.height || 0) / 2;
  const newSize = getElementSize(elementType);
  const midX = Math.round((srcCx + tgtCx) / 2 - newSize.width / 2);
  const midY = Math.round((srcCy + tgtCy) / 2 - newSize.height / 2);

  // Step 1: Delete the existing flow
  modeling.removeElements([flow]);

  // Step 2: Create the new element
  const descriptiveId = generateDescriptiveId(elementRegistry, elementType, elementName);
  const shapeOpts: Record<string, any> = { type: elementType, id: descriptiveId };
  const shape = elementFactory.createShape(shapeOpts);

  // Find the parent container (same as the source element's parent)
  const parent = source.parent;
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

  // Step 3: Re-fetch source/target (they may have shifted internally)
  const updatedSource = elementRegistry.get(sourceId);
  const updatedTarget = elementRegistry.get(targetId);

  // Step 4: Connect source → new element
  const flowId1 = generateFlowId(elementRegistry, updatedSource?.businessObject?.name, elementName);
  const conn1 = modeling.connect(updatedSource, createdElement, {
    type: 'bpmn:SequenceFlow',
    id: flowId1,
  });

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
