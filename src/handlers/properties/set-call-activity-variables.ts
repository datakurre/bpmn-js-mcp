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
// @mutating

import { type ToolResult } from '../../types';
import { missingRequiredError, typeMismatchError } from '../../errors';
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

/** Throws unless `effectiveType` is a CallActivity. */
export function assertCallActivityTarget(effectiveType: string, elementId: string): void {
  if (effectiveType !== 'bpmn:CallActivity') {
    throw typeMismatchError(elementId, effectiveType, ['bpmn:CallActivity']);
  }
}

export interface SetCallActivityVariablesCoreResult {
  inMappingCount: number;
  outMappingCount: number;
}

/**
 * Build and apply camunda:in / camunda:out mappings. Synchronous — no XML
 * sync or lint feedback — so it is safe to call from within a command-stack
 * `preExecute` (see `applyPropertyUpdateItem` in `set-properties.ts`)
 * alongside other elements' updates, grouped into one undo step.
 */
export function applySetCallActivityVariablesCore(
  diagram: ReturnType<typeof requireDiagram>,
  elementId: string,
  args: Pick<SetCallActivityVariablesArgs, 'inMappings' | 'outMappings'>
): SetCallActivityVariablesCoreResult {
  const { inMappings = [], outMappings = [] } = args;

  if (inMappings.length === 0 && outMappings.length === 0) {
    throw missingRequiredError(['inMappings', 'outMappings']);
  }

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;
  const elType = element.type || bo.$type || '';

  assertCallActivityTarget(elType, elementId);

  // Ensure extensionElements container exists
  let extensionElements = bo.extensionElements;
  if (!extensionElements) {
    extensionElements = moddle.create('bpmn:ExtensionElements', {
      values: [],
    }) as unknown as typeof bo.extensionElements;
    extensionElements!.$parent = bo;
  }

  // Remove existing camunda:in and camunda:out elements
  extensionElements!.values = (extensionElements!.values || []).filter(
    (v: any) => v.$type !== 'camunda:In' && v.$type !== 'camunda:Out'
  );

  // Create camunda:in and camunda:out elements
  for (const mapping of inMappings) {
    extensionElements!.values.push(
      createMappingElement(moddle, 'camunda:In', mapping, extensionElements!)
    );
  }
  for (const mapping of outMappings) {
    extensionElements!.values.push(
      createMappingElement(moddle, 'camunda:Out', mapping, extensionElements!)
    );
  }

  modeling.updateProperties(element, { extensionElements });

  return { inMappingCount: inMappings.length, outMappingCount: outMappings.length };
}

export async function handleSetCallActivityVariables(
  args: SetCallActivityVariablesArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId } = args;
  const diagram = requireDiagram(diagramId);

  const counts = applySetCallActivityVariablesCore(diagram, elementId, args);

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    ...counts,
    message: `Set ${counts.inMappingCount} in-mapping(s) and ${counts.outMappingCount} out-mapping(s) on ${elementId}`,
  });
  return appendLintFeedback(result, diagram);
}

/** Shared `{ inMappings, outMappings }` schema fragment (no diagramId/elementId). */
export const CALL_ACTIVITY_VARIABLES_SCHEMA_PROPERTIES = {
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
} as const;

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
      ...CALL_ACTIVITY_VARIABLES_SCHEMA_PROPERTIES,
    },
    required: ['diagramId', 'elementId'],
  },
} as const;
