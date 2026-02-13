/**
 * Handler for set_bpmn_call_activity_variables tool.
 *
 * Manages camunda:in and camunda:out variable mappings on CallActivity
 * elements.  These are distinct from camunda:InputParameter /
 * camunda:OutputParameter (which are for tasks and service tasks).
 *
 * Camunda 7 CallActivities use camunda:in / camunda:out for passing
 * variables between parent and called process.
 */

import { type ToolResult } from '../../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface SetCallActivityVariablesArgs {
  diagramId: string;
  elementId: string;
  inMappings?: Array<{
    source?: string;
    sourceExpression?: string;
    target?: string;
    variables?: 'all';
    local?: boolean;
    businessKey?: string;
  }>;
  outMappings?: Array<{
    source?: string;
    sourceExpression?: string;
    target?: string;
    variables?: 'all';
    local?: boolean;
  }>;
}

interface MappingSpec {
  source?: string;
  sourceExpression?: string;
  target?: string;
  variables?: 'all';
  local?: boolean;
  businessKey?: string;
}

/** Create a camunda:In or camunda:Out moddle element from a mapping spec. */
function createMappingElement(
  moddle: any,
  type: 'camunda:In' | 'camunda:Out',
  mapping: MappingSpec,
  parent: any
): any {
  const attrs: Record<string, any> = {};
  if (mapping.businessKey != null) {
    attrs.businessKey = mapping.businessKey;
  } else if (mapping.variables === 'all') {
    attrs.variables = 'all';
  } else {
    if (mapping.source) attrs.source = mapping.source;
    if (mapping.sourceExpression) attrs.sourceExpression = mapping.sourceExpression;
    if (mapping.target) attrs.target = mapping.target;
  }
  if (mapping.local) attrs.local = true;
  const el = moddle.create(type, attrs);
  el.$parent = parent;
  return el;
}

export async function handleSetCallActivityVariables(
  args: SetCallActivityVariablesArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId, inMappings = [], outMappings = [] } = args;

  if (inMappings.length === 0 && outMappings.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'At least one inMapping or outMapping must be provided'
    );
  }

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;
  const elType = element.type || bo.$type || '';

  if (elType !== 'bpmn:CallActivity') {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `camunda:in / camunda:out mappings can only be set on bpmn:CallActivity elements, got ${elType}`
    );
  }

  // Ensure extensionElements container exists
  let extensionElements = bo.extensionElements;
  if (!extensionElements) {
    extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    extensionElements.$parent = bo;
  }

  // Remove existing camunda:in and camunda:out elements
  extensionElements.values = (extensionElements.values || []).filter(
    (v: any) => v.$type !== 'camunda:In' && v.$type !== 'camunda:Out'
  );

  // Create camunda:in and camunda:out elements
  for (const mapping of inMappings) {
    extensionElements.values.push(
      createMappingElement(moddle, 'camunda:In', mapping, extensionElements)
    );
  }
  for (const mapping of outMappings) {
    extensionElements.values.push(
      createMappingElement(moddle, 'camunda:Out', mapping, extensionElements)
    );
  }

  modeling.updateProperties(element, { extensionElements });

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    inMappingCount: inMappings.length,
    outMappingCount: outMappings.length,
    message: `Set ${inMappings.length} in-mapping(s) and ${outMappings.length} out-mapping(s) on ${elementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_call_activity_variables',
  description:
    "Set Camunda variable mappings (camunda:in / camunda:out) on a CallActivity element. These pass variables between the parent process and the called process. Distinct from camunda:InputParameter/OutputParameter which are for tasks. Supports source/target variable mapping, sourceExpression, and 'all' variables shorthand.",
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the CallActivity element',
      },
      inMappings: {
        type: 'array',
        description: 'Variable mappings from parent process INTO the called process',
        items: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: 'Source variable name in the parent process',
            },
            sourceExpression: {
              type: 'string',
              description: "Expression to evaluate (e.g. '${myVar + 1}')",
            },
            target: {
              type: 'string',
              description: 'Target variable name in the called process',
            },
            variables: {
              type: 'string',
              enum: ['all'],
              description: "Set to 'all' to pass all variables",
            },
            local: {
              type: 'boolean',
              description: 'Whether to use local scope (default: false)',
            },
            businessKey: {
              type: 'string',
              description:
                "Expression for the business key to propagate to the called process (e.g. '${execution.processBusinessKey}')",
            },
          },
        },
      },
      outMappings: {
        type: 'array',
        description: 'Variable mappings from the called process back to the parent',
        items: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: 'Source variable name in the called process',
            },
            sourceExpression: {
              type: 'string',
              description: "Expression to evaluate (e.g. '${result}')",
            },
            target: {
              type: 'string',
              description: 'Target variable name in the parent process',
            },
            variables: {
              type: 'string',
              enum: ['all'],
              description: "Set to 'all' to pass all variables back",
            },
            local: {
              type: 'boolean',
              description: 'Whether to use local scope (default: false)',
            },
          },
        },
      },
    },
    required: ['diagramId', 'elementId'],
    examples: [
      {
        title: 'Pass specific variables to a called process and get results back',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'CallActivity_ProcessPayment',
          inMappings: [
            { source: 'orderId', target: 'orderId' },
            { source: 'amount', target: 'paymentAmount' },
            { businessKey: '${execution.processBusinessKey}' },
          ],
          outMappings: [
            { source: 'paymentStatus', target: 'paymentResult' },
            { source: 'transactionId', target: 'transactionId' },
          ],
        },
      },
      {
        title: 'Pass all variables to a subprocess',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'CallActivity_SubProcess',
          inMappings: [{ variables: 'all' }],
          outMappings: [{ variables: 'all' }],
        },
      },
    ],
  },
} as const;
