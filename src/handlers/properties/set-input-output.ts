/**
 * Handler for set_input_output_mapping tool.
 *
 * Accepts `value` on input/output parameters for both static values and
 * expressions (e.g. `${myVar}`).  Does NOT support `source` or
 * `sourceExpression` — those belong to `camunda:In`/`camunda:Out` for call
 * activity variable mapping, not to `camunda:InputParameter`.
 */

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  upsertExtensionElement,
  validateArgs,
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

export async function handleSetInputOutput(args: SetInputOutputArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId, inputParameters = [], outputParameters = [] } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const moddle = diagram.modeler.get('moddle');

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

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    inputParameterCount: inputParams.length,
    outputParameterCount: outputParams.length,
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
    },
    required: ['diagramId', 'elementId'],
    examples: [
      {
        title: 'Map variables for an HTTP connector service task',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'ServiceTask_FetchOrder',
          inputParameters: [
            { name: 'url', value: 'https://api.example.com/orders/${orderId}' },
            { name: 'method', value: 'GET' },
          ],
          outputParameters: [{ name: 'orderData', value: '${response}' }],
        },
      },
    ],
  },
} as const;
