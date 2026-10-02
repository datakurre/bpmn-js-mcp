/**
 * add_bpmn_elements tool (ADR-032): add one or more elements to a diagram.
 *
 * `elements` is always an array (a single element is an array of one). Each
 * entry carries the full per-element parameter set (see add-element-schema.ts,
 * handled by add-element.ts); `connect` picks sequential auto-connection
 * ('chain', the default) or plain adding ('none'), both handled by
 * add-element-chain.ts.
 */
// @mutating

import { type ToolResult } from '../../types';
import { illegalCombinationError, missingRequiredError } from '../../errors';
import { handleAddElementChain, type AddElementChainArgs } from './add-element-chain';
import { SINGLE_ELEMENT_DEFINITION } from './add-element-schema';

/** Top-level arguments of add_bpmn_elements; per-element options belong inside `elements`. */
const TOP_LEVEL_ARGS = new Set([
  'diagramId',
  'elements',
  'connect',
  'autoLayout',
  'afterElementId',
  'participantId',
  'laneId',
]);

export async function handleAddElements(args: AddElementChainArgs): Promise<ToolResult> {
  if (!Array.isArray(args.elements) || args.elements.length === 0) {
    throw missingRequiredError(['elements (array with at least one element)']);
  }
  const misplaced = Object.entries(args)
    .filter(([key, value]) => value !== undefined && !TOP_LEVEL_ARGS.has(key))
    .map(([key]) => key);
  if (misplaced.length > 0) {
    throw illegalCombinationError(
      `add_bpmn_elements: ${misplaced.join(', ')} must be set inside each entry of "elements", not at the top level. ` +
        'Top-level arguments: diagramId, elements, connect, autoLayout, afterElementId, participantId, laneId.',
      misplaced
    );
  }
  return handleAddElementChain(args);
}

const { properties, allOf } = SINGLE_ELEMENT_DEFINITION.inputSchema;
const { diagramId, ...itemProperties } = properties;

export const TOOL_DEFINITION = {
  name: 'add_bpmn_elements',
  description:
    'Add one or more elements (tasks, gateways, events, etc.) to a BPMN diagram; a single element is an array of one. ' +
    'With connect "chain" (default) each element is connected to the previous one by a sequence flow ' +
    '(afterElementId attaches the first one after an existing element) and the diagram is laid out; ' +
    'with connect "none" they are only added, each placed right of the previous one. ' +
    'Chains containing a gateway are not auto-connected past it — wire branches with connect_bpmn_elements. ' +
    'An entry that sets its own anchor or position (hostElementId, flowId, fromElementId + toLaneId, copyFrom, ' +
    'afterElementId, x/y) is placed there instead of being chained, and then auto-layout is off unless autoLayout is true. ' +
    'Supports boundary events via hostElementId, inserting into a flow via flowId, and cross-lane handoff ' +
    'via fromElementId + toLaneId. Subprocesses are expanded by default (isExpanded=false for collapsed). ' +
    'Generates descriptive element IDs when a name is provided (e.g. UserTask_EnterName). ' +
    'See bpmn://guides/modeling-elements for naming conventions, integration patterns, and event subprocess guidance.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId,
      elements: {
        type: 'array',
        minItems: 1,
        description:
          'Elements to add, in order. participantId, laneId and afterElementId at the top level apply to all entries.',
        items: {
          type: 'object',
          properties: itemProperties,
          required: ['elementType'],
          allOf,
        },
      },
      connect: {
        type: 'string',
        enum: ['chain', 'none'],
        default: 'chain',
        description:
          '"chain" (default) connects each element to the previous one; "none" only adds them, ' +
          'placing each right of the previous one (starting from afterElementId) unless it sets its own anchor/position.',
      },
      afterElementId: {
        type: 'string',
        description: 'Attach the first element after this existing element (auto-positioned).',
      },
      participantId: {
        type: 'string',
        description: 'Default participant (pool) for all entries; overridable per entry.',
      },
      laneId: {
        type: 'string',
        description: 'Default lane for all entries; overridable per entry.',
      },
      autoLayout: {
        type: 'boolean',
        description:
          'Run layout_bpmn_diagram afterwards (chain mode only; default true, but off when a gateway is in ' +
          'the chain or an entry sets its own anchor/position).',
      },
    },
    required: ['diagramId', 'elements'],
  },
} as const;
