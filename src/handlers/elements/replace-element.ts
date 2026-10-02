/**
 * Handler for replace_bpmn_element tool.
 *
 * Replaces an element's type (e.g. bpmn:Task → bpmn:UserTask) while
 * preserving connections, position, name, and other properties.
 * Uses bpmn-js's built-in bpmnReplace service when available.
 */
// @mutating

import { type ToolResult } from '../../types';
import {
  semanticViolationError,
  invalidEnumError,
  createMcpError,
  ERR_INTERNAL,
} from '../../errors';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  getService,
  getTypeSpecificHints,
  getNamingHint,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface ReplaceElementArgs {
  diagramId: string;
  elementId: string;
  newType: string;
}

/** Element types that support replacement. */
export const REPLACEABLE_TYPES = new Set([
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

export interface ReplaceElementCoreResult {
  element: any;
  oldType: string;
  /** True when oldType === newType and no replacement was performed. */
  unchanged: boolean;
}

/**
 * Validate and (unless already of `newType`) replace `elementId`'s type via
 * bpmn-js's `bpmnReplace` service. Synchronous — performs no XML sync or lint
 * feedback — so it is safe to call from within a command-stack `preExecute`
 * (see `applyPropertyUpdateItem` in `set-properties.ts`), where nested
 * `modeling`/`bpmnReplace` calls must all run inside a single execution frame
 * to be grouped as one undo step.
 */
export function replaceElementCore(
  diagram: ReturnType<typeof requireDiagram>,
  elementId: string,
  newType: string
): ReplaceElementCoreResult {
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const element = requireElement(elementRegistry, elementId);

  const oldType = element.type || element.businessObject?.$type || '';

  if (oldType === newType) {
    return { element, oldType, unchanged: true };
  }

  // Block replacement to/from BoundaryEvent — requires host attachment
  if (newType === 'bpmn:BoundaryEvent') {
    throw semanticViolationError(
      'Cannot replace an element to bpmn:BoundaryEvent. Boundary events must be attached to a host element. ' +
        'Use add_bpmn_elements with hostElementId to create a boundary event on a task or subprocess.'
    );
  }
  if (oldType === 'bpmn:BoundaryEvent') {
    throw semanticViolationError(
      'Cannot replace a BoundaryEvent to another type. Delete the boundary event and create the desired ' +
        'element type separately using add_bpmn_elements.'
    );
  }

  if (!REPLACEABLE_TYPES.has(newType)) {
    throw invalidEnumError('newType', newType, [...REPLACEABLE_TYPES]);
  }

  // Use bpmn-js bpmnReplace service for safe type replacement
  let bpmnReplace: any;
  try {
    bpmnReplace = getService(diagram.modeler, 'bpmnReplace');
  } catch {
    throw createMcpError(
      ErrorCode.InternalError,
      'bpmnReplace service not available — cannot replace element type',
      ERR_INTERNAL
    );
  }

  const newElement = bpmnReplace.replaceElement(element, { type: newType });

  if (!newElement) {
    throw createMcpError(
      ErrorCode.InternalError,
      `Failed to replace ${elementId} from ${oldType} to ${newType}`,
      ERR_INTERNAL
    );
  }

  return { element: newElement, oldType, unchanged: false };
}

export async function handleReplaceElement(args: ReplaceElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'newType']);
  const { diagramId, elementId, newType } = args;
  const diagram = requireDiagram(diagramId);

  const { element, oldType, unchanged } = replaceElementCore(diagram, elementId, newType);

  if (unchanged) {
    return jsonResult({
      success: true,
      elementId,
      oldType,
      newType,
      message: `Element ${elementId} is already of type ${newType}, no change needed`,
    });
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId: element.id,
    oldType,
    newType,
    name: element.businessObject?.name || undefined,
    position: { x: element.x, y: element.y },
    message: `Replaced ${elementId} from ${oldType} to ${newType}`,
    ...(element.id !== elementId
      ? { note: `Element ID changed from ${elementId} to ${element.id}` }
      : {}),
    ...getTypeSpecificHints(newType),
    ...getNamingHint(newType, element.businessObject?.name),
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
