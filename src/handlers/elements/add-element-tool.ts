/**
 * add_bpmn_element tool entry point (ADR-032).
 *
 * Routes between the single-element form (`elementType`, handled by
 * add-element.ts) and the multi-element form (`elements`, handled by
 * add-element-chain.ts, formerly the add_bpmn_element_chain tool).
 */
// @mutating

import { type ToolResult } from '../../types';
import { illegalCombinationError } from '../../errors';
import { handleAddElement, type AddElementArgs } from './add-element';
import {
  handleAddElementChain,
  CHAIN_ELEMENT_TYPES,
  type AddElementChainArgs,
} from './add-element-chain';
import { TOOL_DEFINITION as SINGLE_DEFINITION } from './add-element-schema';

/** Arguments that may accompany `elements` (everything else is single-element only). */
const MULTI_FORM_ARGS = new Set([
  'diagramId',
  'elements',
  'connect',
  'autoLayout',
  'afterElementId',
  'participantId',
  'laneId',
]);

export async function handleAddElementTool(
  args: AddElementArgs & Partial<AddElementChainArgs>
): Promise<ToolResult> {
  if (!args.elements) return handleAddElement(args);

  const conflicting = Object.entries(args)
    .filter(([key, value]) => value !== undefined && !MULTI_FORM_ARGS.has(key))
    .map(([key]) => key);
  if (conflicting.length > 0) {
    throw illegalCombinationError(
      `add_bpmn_element: "elements" cannot be combined with ${conflicting.join(', ')}. ` +
        'Put per-element options inside each entry of "elements", or omit "elements" to add a single element.',
      ['elements', ...conflicting]
    );
  }
  return handleAddElementChain(args as AddElementChainArgs);
}

const { properties, ...restSchema } = SINGLE_DEFINITION.inputSchema;

export const TOOL_DEFINITION = {
  name: SINGLE_DEFINITION.name,
  description:
    SINGLE_DEFINITION.description +
    ' **Multiple elements:** pass `elements` (instead of `elementType`) to add several elements in one call; ' +
    'with connect "chain" (default) each is connected to the previous one by a sequence flow ' +
    '(use afterElementId to attach the first after an existing element), with connect "none" they are only added. ' +
    'Chains containing a gateway are not auto-connected past it — wire branches with connect_bpmn_elements.',
  inputSchema: {
    ...restSchema,
    properties: {
      ...properties,
      elements: {
        type: 'array',
        minItems: 1,
        description:
          'Multi-element form (replaces elementType and the other single-element parameters): ' +
          'ordered elements to create. participantId, laneId and afterElementId at the top level apply to all.',
        items: {
          type: 'object',
          properties: {
            elementType: {
              type: 'string',
              enum: Array.from(CHAIN_ELEMENT_TYPES),
              description: 'The BPMN element type',
            },
            name: { type: 'string', description: 'Name/label' },
            participantId: { type: 'string', description: 'Overrides top-level participantId' },
            laneId: { type: 'string', description: 'Overrides top-level laneId' },
            x: {
              type: 'number',
              description: 'X position — only with connect "none" (rejected when chaining)',
            },
            y: {
              type: 'number',
              description: 'Y position — only with connect "none" (rejected when chaining)',
            },
            isExpanded: { type: 'boolean', description: 'For bpmn:SubProcess only' },
            // Event shorthands: same shape and meaning as the top-level parameters.
            eventDefinitionType: { type: 'string' },
            eventDefinitionProperties: { type: 'object' },
            errorRef: { type: 'object' },
            messageRef: { type: 'object' },
            signalRef: { type: 'object' },
            escalationRef: { type: 'object' },
          },
          required: ['elementType'],
        },
      },
      connect: {
        type: 'string',
        enum: ['chain', 'none'],
        default: 'chain',
        description:
          'With elements: "chain" (default) connects each element to the previous one; "none" only adds them, ' +
          'placing each right of the previous one (starting from afterElementId) unless it has an explicit x/y.',
      },
      autoLayout: {
        type: 'boolean',
        default: true,
        description:
          'With elements and connect "chain": run layout_bpmn_diagram afterwards (default true; skipped when a gateway is in the chain).',
      },
    },
    required: ['diagramId'],
    anyOf: [{ required: ['elementType'] }, { required: ['elements'] }],
  },
} as const;
