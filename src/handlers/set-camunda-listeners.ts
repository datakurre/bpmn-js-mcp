/**
 * Handler for set_bpmn_camunda_listeners tool (merged with set_bpmn_camunda_error).
 *
 * Creates camunda:ExecutionListener, camunda:TaskListener, and
 * camunda:ErrorEventDefinition extension elements on BPMN elements.
 * Execution listeners can be attached to any flow node or process.
 * Task listeners are specific to UserTasks.
 * Error definitions are specific to ServiceTasks (Camunda 7 External Task error handling).
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  resolveOrCreateError,
  validateArgs,
} from './helpers';
import { appendLintFeedback } from '../linter';

export interface SetCamundaListenersArgs {
  diagramId: string;
  elementId: string;
  executionListeners?: Array<{
    event: string;
    class?: string;
    delegateExpression?: string;
    expression?: string;
    script?: { scriptFormat: string; value: string };
  }>;
  taskListeners?: Array<{
    event: string;
    class?: string;
    delegateExpression?: string;
    expression?: string;
    script?: { scriptFormat: string; value: string };
  }>;
  errorDefinitions?: Array<{
    id: string;
    expression?: string;
    errorRef?: { id: string; name?: string; errorCode?: string };
  }>;
}

function createListenerElement(
  moddle: any,
  type: 'camunda:ExecutionListener' | 'camunda:TaskListener',
  listener: {
    event: string;
    class?: string;
    delegateExpression?: string;
    expression?: string;
    script?: { scriptFormat: string; value: string };
  }
): any {
  const attrs: Record<string, any> = { event: listener.event };

  if (listener.class) {
    attrs['class'] = listener.class;
  } else if (listener.delegateExpression) {
    attrs.delegateExpression = listener.delegateExpression;
  } else if (listener.expression) {
    attrs.expression = listener.expression;
  }

  const el = moddle.create(type, attrs);

  // Inline script support
  if (listener.script) {
    const scriptEl = moddle.create('camunda:Script', {
      scriptFormat: listener.script.scriptFormat,
      value: listener.script.value,
    });
    scriptEl.$parent = el;
    el.script = scriptEl;
  }

  return el;
}

/** Create camunda:ErrorEventDefinition entries and add to extension elements. */
function createErrorDefinitions(
  diagram: any,
  moddle: any,
  extensionElements: any,
  errorDefinitions: SetCamundaListenersArgs['errorDefinitions']
): void {
  if (!errorDefinitions || errorDefinitions.length === 0) return;

  const canvas = diagram.modeler.get('canvas');
  const rootElement = canvas.getRootElement();
  const definitions = rootElement.businessObject.$parent;

  for (const errDef of errorDefinitions) {
    const errorElement = errDef.errorRef
      ? resolveOrCreateError(moddle, definitions, errDef.errorRef)
      : undefined;

    const camundaErrDef = moddle.create('camunda:ErrorEventDefinition', {
      id: errDef.id,
      expression: errDef.expression,
    });
    if (errorElement) camundaErrDef.errorRef = errorElement;
    camundaErrDef.$parent = extensionElements;
    extensionElements.values.push(camundaErrDef);
  }
}

export async function handleSetCamundaListeners(
  args: SetCamundaListenersArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const {
    diagramId,
    elementId,
    executionListeners = [],
    taskListeners = [],
    errorDefinitions = [],
  } = args;

  if (
    executionListeners.length === 0 &&
    taskListeners.length === 0 &&
    errorDefinitions.length === 0
  ) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'At least one executionListener, taskListener, or errorDefinition must be provided'
    );
  }

  const diagram = requireDiagram(diagramId);
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const moddle = diagram.modeler.get('moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;
  const elType = element.type || bo.$type || '';

  if (taskListeners.length > 0 && !elType.includes('UserTask')) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Task listeners can only be set on bpmn:UserTask elements, got ${elType}`
    );
  }

  if (errorDefinitions.length > 0 && bo.$type !== 'bpmn:ServiceTask') {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `camunda:ErrorEventDefinition is only supported on bpmn:ServiceTask (got ${bo.$type})`
    );
  }

  // Ensure extensionElements container exists
  let extensionElements = bo.extensionElements;
  if (!extensionElements) {
    extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    extensionElements.$parent = bo;
  }

  // Remove existing listeners of the types we're setting
  const typesToRemove = new Set<string>();
  if (executionListeners.length > 0) typesToRemove.add('camunda:ExecutionListener');
  if (taskListeners.length > 0) typesToRemove.add('camunda:TaskListener');
  if (errorDefinitions.length > 0) typesToRemove.add('camunda:ErrorEventDefinition');
  extensionElements.values = (extensionElements.values || []).filter(
    (v: any) => !typesToRemove.has(v.$type)
  );

  // Create listeners
  for (const listener of executionListeners) {
    const el = createListenerElement(moddle, 'camunda:ExecutionListener', listener);
    el.$parent = extensionElements;
    extensionElements.values.push(el);
  }
  for (const listener of taskListeners) {
    const el = createListenerElement(moddle, 'camunda:TaskListener', listener);
    el.$parent = extensionElements;
    extensionElements.values.push(el);
  }

  createErrorDefinitions(diagram, moddle, extensionElements, errorDefinitions);
  modeling.updateProperties(element, { extensionElements });
  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    executionListenerCount: executionListeners.length,
    taskListenerCount: taskListeners.length,
    errorDefinitionCount: errorDefinitions.length,
    message: `Set ${executionListeners.length} execution listener(s), ${taskListeners.length} task listener(s), and ${errorDefinitions.length} error definition(s) on ${elementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_camunda_listeners',
  description:
    'Set Camunda extension elements on a BPMN element: execution listeners, task listeners, and/or error event definitions. ' +
    'Execution listeners can be attached to any flow node or process. Task listeners are specific to UserTasks. ' +
    'Error definitions (camunda:ErrorEventDefinition) are specific to ServiceTasks for Camunda 7 External Task error handling.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to configure',
      },
      executionListeners: {
        type: 'array',
        description: 'Execution listeners to set (replaces existing)',
        items: {
          type: 'object',
          properties: {
            event: {
              type: 'string',
              description: "Listener event: 'start', 'end', or 'take' (for sequence flows)",
            },
            class: {
              type: 'string',
              description: 'Fully qualified Java class name implementing ExecutionListener',
            },
            delegateExpression: {
              type: 'string',
              description: "Expression resolving to a listener bean (e.g. '${myListenerBean}')",
            },
            expression: {
              type: 'string',
              description: "UEL expression to evaluate (e.g. '${myBean.notify(execution)}')",
            },
            script: {
              type: 'object',
              description: 'Inline script for the listener',
              properties: {
                scriptFormat: {
                  type: 'string',
                  description: "Script language (e.g. 'groovy', 'javascript')",
                },
                value: { type: 'string', description: 'The script body' },
              },
              required: ['scriptFormat', 'value'],
            },
          },
          required: ['event'],
        },
      },
      taskListeners: {
        type: 'array',
        description: 'Task listeners to set (UserTask only, replaces existing)',
        items: {
          type: 'object',
          properties: {
            event: {
              type: 'string',
              description: "Listener event: 'create', 'assignment', 'complete', or 'delete'",
            },
            class: {
              type: 'string',
              description: 'Fully qualified Java class name implementing TaskListener',
            },
            delegateExpression: {
              type: 'string',
              description: 'Expression resolving to a listener bean',
            },
            expression: {
              type: 'string',
              description: 'UEL expression to evaluate',
            },
            script: {
              type: 'object',
              description: 'Inline script for the listener',
              properties: {
                scriptFormat: {
                  type: 'string',
                  description: "Script language (e.g. 'groovy', 'javascript')",
                },
                value: { type: 'string', description: 'The script body' },
              },
              required: ['scriptFormat', 'value'],
            },
          },
          required: ['event'],
        },
      },
      errorDefinitions: {
        type: 'array',
        description:
          'camunda:ErrorEventDefinition entries for ServiceTask error handling (replaces existing). ' +
          'Distinct from standard bpmn:ErrorEventDefinition on boundary events.',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique ID for the error event definition',
            },
            expression: {
              type: 'string',
              description: 'Error expression (e.g. \'${error.code == "ERR_001"}\')',
            },
            errorRef: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Error element ID' },
                name: { type: 'string', description: 'Error name' },
                errorCode: { type: 'string', description: 'Error code' },
              },
              required: ['id'],
              description: 'Reference to a bpmn:Error root element (created if not existing)',
            },
          },
          required: ['id'],
        },
      },
    },
    required: ['diagramId', 'elementId'],
  },
} as const;
