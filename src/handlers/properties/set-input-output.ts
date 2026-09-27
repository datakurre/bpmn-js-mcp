/**
 * Handler for set_input_output_mapping tool.
 *
 * Accepts `value` on input/output parameters for both static values and
 * expressions (e.g. `${myVar}`).  Does NOT support `source` or
 * `sourceExpression` — those belong to `camunda:In`/`camunda:Out` for call
 * activity variable mapping, not to `camunda:InputParameter`.
 */
// @mutating

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  upsertExtensionElement,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface IoParameterValue {
  name: string;
  value?: string;
  list?: string[];
  map?: Record<string, string>;
  script?: { scriptFormat: string; value: string; resource?: string };
}

export interface SetInputOutputArgs {
  diagramId: string;
  elementId: string;
  inputParameters?: IoParameterValue[];
  outputParameters?: IoParameterValue[];
}

/** Shared `{ inputParameters, outputParameters }` schema fragment (no diagramId/elementId). */
export const IO_PARAMETERS_SCHEMA_PROPERTIES = {
  inputParameters: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Parameter name' },
        value: {
          type: 'string',
          description:
            "Static value or expression. Examples: '123', '${myVar}', '${execution.getVariable('orderId')}'.",
        },
        list: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of values (creates camunda:List). Mutually exclusive with value/map/script.',
        },
        map: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Key-value map (creates camunda:Map). Mutually exclusive with value/list/script.',
        },
        script: {
          type: 'object',
          properties: {
            scriptFormat: {
              type: 'string',
              description: "Script language (e.g. 'groovy', 'javascript')",
            },
            value: { type: 'string', description: 'Inline script body' },
            resource: {
              type: 'string',
              description: 'External script resource path (alternative to inline value)',
            },
          },
          required: ['scriptFormat'],
          description:
            'Script value (creates camunda:Script). Mutually exclusive with value/list/map.',
        },
      },
      required: ['name'],
    },
    description: 'Input parameters to set',
  },
  outputParameters: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Parameter name' },
        value: {
          type: 'string',
          description: "Static value or expression. Examples: 'ok', '${result}'.",
        },
        list: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of values (creates camunda:List). Mutually exclusive with value/map/script.',
        },
        map: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Key-value map (creates camunda:Map). Mutually exclusive with value/list/script.',
        },
        script: {
          type: 'object',
          properties: {
            scriptFormat: {
              type: 'string',
              description: "Script language (e.g. 'groovy', 'javascript')",
            },
            value: { type: 'string', description: 'Inline script body' },
            resource: {
              type: 'string',
              description: 'External script resource path (alternative to inline value)',
            },
          },
          required: ['scriptFormat'],
          description:
            'Script value (creates camunda:Script). Mutually exclusive with value/list/map.',
        },
      },
      required: ['name'],
    },
    description: 'Output parameters to set',
  },
} as const;

/** Build a camunda:InputParameter or camunda:OutputParameter with optional complex value. */
function buildParameter(
  moddle: any,
  type: 'camunda:InputParameter' | 'camunda:OutputParameter',
  p: IoParameterValue
): any {
  const attrs: Record<string, any> = { name: p.name };
  if (p.value !== undefined) attrs.value = p.value;
  const param = moddle.create(type, attrs);

  // camunda:List value
  if (p.list) {
    const items = p.list.map((v) => moddle.create('camunda:Value', { value: v }));
    const listEl = moddle.create('camunda:List', { items });
    items.forEach((item: any) => (item.$parent = listEl));
    listEl.$parent = param;
    param.definition = listEl;
  }

  // camunda:Map value
  if (p.map) {
    const entries = Object.entries(p.map).map(([key, value]) =>
      moddle.create('camunda:Entry', { key, value })
    );
    const mapEl = moddle.create('camunda:Map', { entries });
    entries.forEach((entry: any) => (entry.$parent = mapEl));
    mapEl.$parent = param;
    param.definition = mapEl;
  }

  // camunda:Script value
  if (p.script) {
    const scriptAttrs: Record<string, any> = {
      scriptFormat: p.script.scriptFormat,
    };
    if (p.script.resource) {
      scriptAttrs.resource = p.script.resource;
    } else {
      scriptAttrs.value = p.script.value;
    }
    const scriptEl = moddle.create('camunda:Script', scriptAttrs);
    scriptEl.$parent = param;
    param.definition = scriptEl;
  }

  return param;
}

export interface SetInputOutputCoreResult {
  inputParameterCount: number;
  outputParameterCount: number;
}

/**
 * Build and upsert the camunda:InputOutput extension element. Synchronous —
 * no XML sync or lint feedback — so it is safe to call from within a
 * command-stack `preExecute` (see `applyPropertyUpdateItem` in
 * `set-properties.ts`) alongside other elements' updates, grouped into one
 * undo step.
 */
export function applySetInputOutputCore(
  diagram: ReturnType<typeof requireDiagram>,
  elementId: string,
  args: Pick<SetInputOutputArgs, 'inputParameters' | 'outputParameters'>
): SetInputOutputCoreResult {
  const { inputParameters = [], outputParameters = [] } = args;
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  // Build camunda:InputParameter elements
  const inputParams = inputParameters.map((p) =>
    buildParameter(moddle, 'camunda:InputParameter', p)
  );

  // Build camunda:OutputParameter elements
  const outputParams = outputParameters.map((p) =>
    buildParameter(moddle, 'camunda:OutputParameter', p)
  );

  // Build camunda:InputOutput element
  const ioAttrs: Record<string, any> = {};
  if (inputParams.length > 0) ioAttrs.inputParameters = inputParams;
  if (outputParams.length > 0) ioAttrs.outputParameters = outputParams;
  const inputOutput = moddle.create('camunda:InputOutput', ioAttrs);

  upsertExtensionElement(moddle, bo, modeling, element, 'camunda:InputOutput', inputOutput);

  return { inputParameterCount: inputParams.length, outputParameterCount: outputParams.length };
}

export async function handleSetInputOutput(args: SetInputOutputArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId } = args;
  const diagram = requireDiagram(diagramId);

  const counts = applySetInputOutputCore(diagram, elementId, args);

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    ...counts,
    message: `Set input/output mapping on ${elementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_input_output_mapping',
  description:
    "Set Camunda input/output parameter mappings on an element. Creates camunda:InputOutput extension elements with camunda:InputParameter and camunda:OutputParameter children. The 'value' field accepts both static values (e.g. '123') and expressions (e.g. '${myVar}', '${execution.getVariable('name')}'). Supports complex value types: 'list' (string array), 'map' (key-value object), and 'script' (inline or external script).",
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to update',
      },
      ...IO_PARAMETERS_SCHEMA_PROPERTIES,
    },
    required: ['diagramId', 'elementId'],
  },
} as const;
