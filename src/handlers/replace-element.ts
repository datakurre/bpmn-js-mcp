/**
 * Handler for replace_bpmn_element tool.
 *
 * Replaces an element's type (e.g. bpmn:Task → bpmn:UserTask) while
 * preserving connections, position, name, and other properties.
 * Uses bpmn-js's built-in bpmnReplace service when available.
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from './helpers';
import { appendLintFeedback } from '../linter';
import { getTypeSpecificHints } from './type-hints';

export interface ReplaceElementArgs {
  diagramId: string;
  elementId: string;
  newType: string;
}

/** Element types that support replacement. */
const REPLACEABLE_TYPES = new Set([
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
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:SubProcess',
]);

export async function handleReplaceElement(args: ReplaceElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'newType']);
  const { diagramId, elementId, newType } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const element = requireElement(elementRegistry, elementId);

  const oldType = element.type || element.businessObject?.$type || '';

  if (oldType === newType) {
    return jsonResult({
      success: true,
      elementId,
      oldType,
      newType,
      message: `Element ${elementId} is already of type ${newType}, no change needed`,
    });
  }

  // Block replacement to/from BoundaryEvent — requires host attachment
  if (newType === 'bpmn:BoundaryEvent') {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Cannot replace an element to bpmn:BoundaryEvent. Boundary events must be attached to a host element. ' +
        'Use add_bpmn_element with hostElementId to create a boundary event on a task or subprocess.'
    );
  }
  if (oldType === 'bpmn:BoundaryEvent') {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Cannot replace a BoundaryEvent to another type. Delete the boundary event and create the desired ' +
        'element type separately using add_bpmn_element.'
    );
  }

  if (!REPLACEABLE_TYPES.has(newType)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Cannot replace to type ${newType}. Supported types: ${[...REPLACEABLE_TYPES].join(', ')}`
    );
  }

  // Use bpmn-js bpmnReplace service for safe type replacement
  let bpmnReplace: any;
  try {
    bpmnReplace = diagram.modeler.get('bpmnReplace');
  } catch {
    throw new McpError(
      ErrorCode.InternalError,
      'bpmnReplace service not available — cannot replace element type'
    );
  }

  const newElement = bpmnReplace.replaceElement(element, { type: newType });

  if (!newElement) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to replace ${elementId} from ${oldType} to ${newType}`
    );
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId: newElement.id,
    oldType,
    newType,
    name: newElement.businessObject?.name || undefined,
    position: { x: newElement.x, y: newElement.y },
    message: `Replaced ${elementId} from ${oldType} to ${newType}`,
    ...(newElement.id !== elementId
      ? { note: `Element ID changed from ${elementId} to ${newElement.id}` }
      : {}),
    ...getTypeSpecificHints(newType),
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'replace_bpmn_element',
  description:
    "Replace an element's type (e.g. bpmn:Task → bpmn:UserTask) while preserving " +
    "connections, position, name, and other compatible properties. Uses bpmn-js's " +
    'built-in replace mechanism which correctly handles reconnection of sequence flows ' +
    'and boundary events. The element ID may change after replacement.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to replace',
      },
      newType: {
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
          'bpmn:StartEvent',
          'bpmn:EndEvent',
          'bpmn:SubProcess',
        ],
        description: 'The new BPMN element type',
      },
    },
    required: ['diagramId', 'elementId', 'newType'],
  },
} as const;
