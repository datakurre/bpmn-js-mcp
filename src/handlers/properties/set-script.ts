/**
 * Handler for set_bpmn_script tool.
 *
 * Sets inline script content on a ScriptTask element, including
 * the script body, format (language), and optional result variable.
 */

import { type ToolResult } from '../../types';
import { illegalCombinationError, missingRequiredError, typeMismatchError } from '../../errors';
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface SetScriptArgs {
  diagramId: string;
  elementId: string;
  scriptFormat: string;
  script?: string;
  resultVariable?: string;
  resource?: string;
}

export async function handleSetScript(args: SetScriptArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'scriptFormat']);
  const { diagramId, elementId, scriptFormat, script, resultVariable, resource } = args;

  if (!script && !resource) {
    throw missingRequiredError(['script']);
  }
  if (script && resource) {
    throw illegalCombinationError(
      'Cannot set both script (inline) and resource (external file). Provide only one.',
      ['script', 'resource']
    );
  }

  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  if (!bo.$type.includes('ScriptTask')) {
    throw typeMismatchError(elementId, bo.$type, ['bpmn:ScriptTask']);
  }

  // Set the script properties directly on the business object
  const props: Record<string, any> = {
    scriptFormat,
    'camunda:resultVariable': resultVariable || undefined,
  };

  if (resource) {
    props['camunda:resource'] = resource;
  }

  modeling.updateProperties(element, props);

  // Set the script body — bpmn-js stores this as the `script` property
  // on the business object (the element body in XML)
  if (script) {
    bo.script = script;
    // Clear resource if switching from resource to inline
    if (bo['camunda:resource']) {
      modeling.updateProperties(element, { 'camunda:resource': undefined });
    }
  } else if (resource) {
    // Clear inline script when using external resource
    bo.script = undefined;
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    scriptFormat,
    ...(script ? { scriptLength: script.length } : {}),
    ...(resource ? { resource } : {}),
    resultVariable: resultVariable || undefined,
    message: resource
      ? `Set external ${scriptFormat} script resource '${resource}' on ${elementId}`
      : `Set inline ${scriptFormat} script on ${elementId} (${script!.length} chars)`,
    nextSteps: [
      {
        tool: 'connect_bpmn_elements',
        description: 'Connect this script task to the next element in the process flow.',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_script',
  description:
    'Set inline script content on a ScriptTask element. Supports any script language (groovy, javascript, python, etc.) and an optional result variable for Camunda 7. Use either script (inline body) or resource (external file path), not both.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the ScriptTask element',
      },
      scriptFormat: {
        type: 'string',
        description: "The scripting language (e.g. 'groovy', 'javascript', 'python', 'juel')",
      },
      script: {
        type: 'string',
        description: 'The inline script body',
      },
      resource: {
        type: 'string',
        description:
          "Camunda 7: external script file path (camunda:resource). Alternative to inline script (e.g. 'classpath://scripts/my-script.groovy')",
      },
      resultVariable: {
        type: 'string',
        description:
          'Camunda 7: variable name to store the script result in (camunda:resultVariable)',
      },
    },
    required: ['diagramId', 'elementId', 'scriptFormat'],
    examples: [
      {
        title: 'Set a Groovy script with result variable',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'ScriptTask_CalcTotal',
          scriptFormat: 'groovy',
          script: 'def total = orderItems.sum { it.price * it.quantity }\ntotal',
          resultVariable: 'orderTotal',
        },
      },
      {
        title: 'Reference an external script file',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'ScriptTask_Transform',
          scriptFormat: 'groovy',
          resource: 'classpath://scripts/transform-data.groovy',
        },
      },
    ],
  },
} as const;
