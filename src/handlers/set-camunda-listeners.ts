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
    fields?: Array<{ name: string; stringValue?: string; string?: string; expression?: string }>;
  }>;
  taskListeners?: Array<{
    event: string;
    id?: string;
    class?: string;
    delegateExpression?: string;
    expression?: string;
    script?: { scriptFormat: string; value: string };
    fields?: Array<{ name: string; stringValue?: string; string?: string; expression?: string }>;
    timerEventDefinition?: { timeDuration?: string; timeDate?: string; timeCycle?: string };
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
    id?: string;
    class?: string;
    delegateExpression?: string;
    expression?: string;
    script?: { scriptFormat: string; value: string };
    fields?: Array<{ name: string; stringValue?: string; string?: string; expression?: string }>;
    timerEventDefinition?: { timeDuration?: string; timeDate?: string; timeCycle?: string };
  }
): any {
  const attrs: Record<string, any> = { event: listener.event };
  if (listener.id) {
    attrs.id = listener.id;
  }

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

  // Field injection support
  if (listener.fields && listener.fields.length > 0) {
    el.fields = listener.fields.map((f) => {
      const attrs: Record<string, any> = { name: f.name };
      if (f.stringValue != null) attrs.stringValue = f.stringValue;
      if (f.string != null) attrs.string = f.string;
      if (f.expression != null) attrs.expression = f.expression;
      const fieldEl = moddle.create('camunda:Field', attrs);
      fieldEl.$parent = el;
      return fieldEl;
    });
  }

  // Timer event definition support (task listener timeout)
  if (type === 'camunda:TaskListener' && listener.timerEventDefinition) {
    const timerDef = listener.timerEventDefinition;
    const timerAttrs: Record<string, any> = {};
    const timerEl = moddle.create('bpmn:TimerEventDefinition', timerAttrs);

    if (timerDef.timeDuration) {
      const formalExpr = moddle.create('bpmn:FormalExpression', {
        body: timerDef.timeDuration,
      });
      formalExpr.$parent = timerEl;
      timerEl.timeDuration = formalExpr;
    } else if (timerDef.timeDate) {
      const formalExpr = moddle.create('bpmn:FormalExpression', {
        body: timerDef.timeDate,
      });
      formalExpr.$parent = timerEl;
      timerEl.timeDate = formalExpr;
    } else if (timerDef.timeCycle) {
      const formalExpr = moddle.create('bpmn:FormalExpression', {
        body: timerDef.timeCycle,
      });
      formalExpr.$parent = timerEl;
      timerEl.timeCycle = formalExpr;
    }

    timerEl.$parent = el;
    el.eventDefinitions = [timerEl];
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

export { TOOL_DEFINITION } from './set-camunda-listeners-schema';
