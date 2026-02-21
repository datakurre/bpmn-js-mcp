/**
 * Handler for add_bpmn_element_chain tool.
 *
 * Convenience tool that creates a sequence of BPMN elements and connects
 * them in order, reducing round-trips compared to calling add_bpmn_element
 * multiple times. Internally uses add_bpmn_element with afterElementId
 * chaining.
 */
// @mutating

import { type ToolResult } from '../../types';
import { missingRequiredError, typeMismatchError } from '../../errors';
import { requireDiagram, jsonResult, validateArgs, buildElementCounts } from '../helpers';
import { getService } from '../../bpmn-types';
import { appendLintFeedback } from '../../linter';
import { handleAddElement } from './add-element';
import { handleLayoutDiagram } from '../layout/layout-diagram';

export interface AddElementChainArgs {
  diagramId: string;
  /** Array of elements to create in order. */
  elements: Array<{
    /** BPMN element type (e.g. 'bpmn:UserTask', 'bpmn:ExclusiveGateway'). */
    elementType: string;
    /** Optional name/label for the element. */
    name?: string;
    /** Optional participant pool to place element into. */
    participantId?: string;
    /** Optional lane to place element into. */
    laneId?: string;
  }>;
  /** Optional: connect the first element after this existing element ID. */
  afterElementId?: string;
  /** Optional participant pool for all elements (can be overridden per-element). */
  participantId?: string;
  /** Optional lane for all elements (can be overridden per-element). */
  laneId?: string;
  /**
   * When true, run layout_bpmn_diagram automatically after the chain is built.
   * Defaults to true — chains connect elements, so layout is almost always desired.
   * Pass false to skip layout (e.g. when further elements will be added before layout).
   */
  autoLayout?: boolean;
}

const CHAIN_ELEMENT_TYPES = new Set([
  'bpmn:StartEvent',
  'bpmn:EndEvent',
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
]);

export async function handleAddElementChain(args: AddElementChainArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elements']);
  const { diagramId, elements, afterElementId } = args;

  if (!Array.isArray(elements) || elements.length === 0) {
    throw missingRequiredError(['elements']);
  }

  // Validate all element types up front before creating anything
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el.elementType) {
      throw missingRequiredError([`elements[${i}].elementType`]);
    }
    if (!CHAIN_ELEMENT_TYPES.has(el.elementType)) {
      throw typeMismatchError(`elements[${i}]`, el.elementType, Array.from(CHAIN_ELEMENT_TYPES));
    }
  }

  const diagram = requireDiagram(diagramId);

  const createdElements: Array<{
    elementId: string;
    elementType: string;
    name?: string;
    connectionId?: string;
  }> = [];

  let previousId = afterElementId;

  for (const el of elements) {
    const addResult = await handleAddElement({
      diagramId,
      elementType: el.elementType,
      name: el.name,
      participantId: el.participantId || args.participantId,
      laneId: el.laneId || args.laneId,
      ...(previousId ? { afterElementId: previousId } : {}),
      autoLayout: false,
    });

    const parsed = JSON.parse(addResult.content[0].text);
    createdElements.push({
      elementId: parsed.elementId,
      elementType: el.elementType,
      name: el.name,
      ...(parsed.connectionId ? { connectionId: parsed.connectionId } : {}),
    });

    previousId = parsed.elementId;
  }

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  // Run layout once for the whole chain (default: true, since chains always create connected flows)
  const shouldLayout = args.autoLayout !== false;
  if (shouldLayout) {
    await handleLayoutDiagram({ diagramId });
  }

  const result = jsonResult({
    success: true,
    elementIds: createdElements.map((e) => e.elementId),
    elements: createdElements,
    elementCount: createdElements.length,
    message: `Created chain of ${createdElements.length} elements: ${createdElements.map((e) => e.name || e.elementType).join(' → ')}`,
    diagramCounts: buildElementCounts(elementRegistry),
    ...(shouldLayout ? { autoLayoutApplied: true } : {}),
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'add_bpmn_element_chain',
  description:
    'Add a chain of BPMN elements connected in sequence, reducing round-trips. ' +
    'Creates each element and auto-connects it to the previous one via sequence flows. ' +
    'Equivalent to calling add_bpmn_element multiple times with afterElementId chaining. ' +
    'Use afterElementId to attach the chain after an existing element. ' +
    'For branching/merging patterns, use add_bpmn_element and connect_bpmn_elements instead.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elements: {
        type: 'array',
        description: 'Ordered array of elements to create and connect sequentially.',
        items: {
          type: 'object',
          properties: {
            elementType: {
              type: 'string',
              description: 'The BPMN element type (e.g. bpmn:UserTask, bpmn:ServiceTask)',
              enum: Array.from(CHAIN_ELEMENT_TYPES),
            },
            name: { type: 'string', description: 'Optional name/label for the element' },
            participantId: {
              type: 'string',
              description: 'Optional participant pool (overrides top-level participantId)',
            },
            laneId: {
              type: 'string',
              description: 'Optional lane (overrides top-level laneId)',
            },
          },
          required: ['elementType'],
        },
        minItems: 1,
      },
      afterElementId: {
        type: 'string',
        description:
          'Connect the first element in the chain after this existing element. ' +
          'If omitted, the chain starts unconnected.',
      },
      participantId: {
        type: 'string',
        description: 'Default participant pool for all elements (can be overridden per-element).',
      },
      laneId: {
        type: 'string',
        description: 'Default lane for all elements (can be overridden per-element).',
      },
      autoLayout: {
        type: 'boolean',
        default: true,
        description:
          'When true (default), run layout_bpmn_diagram after the chain is built. ' +
          'Pass false to skip auto-layout when more elements will be added first.',
      },
    },
    required: ['diagramId', 'elements'],
  },
} as const;
