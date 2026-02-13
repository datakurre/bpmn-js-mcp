/**
 * Handler for set_event_definition tool.
 */

import { type ToolResult } from '../../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  resolveOrCreateError,
  resolveOrCreateMessage,
  resolveOrCreateSignal,
  resolveOrCreateEscalation,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface SetEventDefinitionArgs {
  diagramId: string;
  elementId: string;
  eventDefinitionType: string;
  properties?: Record<string, any>;
  errorRef?: { id: string; name?: string; errorCode?: string; errorMessage?: string };
  messageRef?: { id: string; name?: string };
  signalRef?: { id: string; name?: string };
  escalationRef?: { id: string; name?: string; escalationCode?: string };
}

// ── Type-specific attribute builders ───────────────────────────────────────

/** Build timer attributes (exactly one of timeDuration/timeDate/timeCycle). */
function buildTimerAttrs(moddle: any, defProps: Record<string, any>): Record<string, any> {
  const timerKeys = ['timeDuration', 'timeDate', 'timeCycle'].filter((k) => defProps[k]);
  if (timerKeys.length > 1) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Timer events accept only one of timeDuration, timeDate, or timeCycle — got: ${timerKeys.join(', ')}`
    );
  }
  if (timerKeys.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'TimerEventDefinition requires one of: timeDuration (ISO 8601 duration, e.g. PT15M), timeDate (ISO 8601 date, e.g. 2025-12-31T23:59:00Z), or timeCycle (ISO 8601 repeating interval, e.g. R3/PT10M)'
    );
  }
  const attrs: Record<string, any> = {};
  for (const key of timerKeys) {
    attrs[key] = moddle.create('bpmn:FormalExpression', { body: defProps[key] });
  }
  return attrs;
}

/** Resolve root-level definitions element from the diagram. */
function getDefinitions(diagram: ReturnType<typeof requireDiagram>): any {
  const canvas = getService(diagram.modeler, 'canvas');
  return canvas.getRootElement().businessObject.$parent;
}

/** Ref-type → resolver function + arg key mapping. */
const REF_RESOLVERS: Record<
  string,
  { argKey: string; attrKey: string; resolver: (...a: any[]) => any }
> = {
  'bpmn:ErrorEventDefinition': {
    argKey: 'errorRef',
    attrKey: 'errorRef',
    resolver: resolveOrCreateError,
  },
  'bpmn:MessageEventDefinition': {
    argKey: 'messageRef',
    attrKey: 'messageRef',
    resolver: resolveOrCreateMessage,
  },
  'bpmn:SignalEventDefinition': {
    argKey: 'signalRef',
    attrKey: 'signalRef',
    resolver: resolveOrCreateSignal,
  },
  'bpmn:EscalationEventDefinition': {
    argKey: 'escalationRef',
    attrKey: 'escalationRef',
    resolver: resolveOrCreateEscalation,
  },
};

// ── Camunda extension attributes on event definitions ──────────────────────

/** Map of eventDefinitionType → Camunda property names to copy from defProps. */
const CAMUNDA_EVENT_DEF_PROPS: Record<string, string[]> = {
  'bpmn:ConditionalEventDefinition': ['variableName', 'variableEvents'],
  'bpmn:ErrorEventDefinition': ['errorCodeVariable', 'errorMessageVariable'],
  'bpmn:EscalationEventDefinition': ['escalationCodeVariable'],
  'bpmn:SignalEventDefinition': ['async'],
};

/** Apply Camunda-specific extension props (variableName, errorCodeVariable, etc.) to an event definition. */
function applyCamundaEventDefProps(
  eventDef: any,
  eventDefinitionType: string,
  defProps: Record<string, any>
): void {
  const propNames = CAMUNDA_EVENT_DEF_PROPS[eventDefinitionType];
  if (!propNames) return;
  for (const prop of propNames) {
    if (defProps[prop] != null) {
      eventDef[prop] = defProps[prop];
    }
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleSetEventDefinition(args: SetEventDefinitionArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'eventDefinitionType']);
  const {
    diagramId,
    elementId,
    eventDefinitionType,
    properties: defProps = {},
    errorRef,
    messageRef,
    signalRef,
    escalationRef,
  } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  // Verify element is an event type
  if (!bo.$type.includes('Event')) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Element ${elementId} is not an event (type: ${bo.$type})`
    );
  }

  // Build event definition attributes based on type
  let eventDefAttrs: Record<string, any> = {};

  if (eventDefinitionType === 'bpmn:TimerEventDefinition') {
    eventDefAttrs = buildTimerAttrs(moddle, defProps);
  } else if (eventDefinitionType === 'bpmn:ConditionalEventDefinition' && defProps.condition) {
    eventDefAttrs.condition = moddle.create('bpmn:FormalExpression', { body: defProps.condition });
  } else if (eventDefinitionType === 'bpmn:LinkEventDefinition' && defProps.name) {
    eventDefAttrs.name = defProps.name;
  }

  // Resolve root-level references (error, message, signal, escalation)
  const refArgs: Record<string, any> = { errorRef, messageRef, signalRef, escalationRef };
  const refEntry = REF_RESOLVERS[eventDefinitionType];
  if (refEntry && refArgs[refEntry.argKey]) {
    const definitions = getDefinitions(diagram);
    eventDefAttrs[refEntry.attrKey] = refEntry.resolver(
      moddle,
      definitions,
      refArgs[refEntry.argKey]
    );
  }

  const eventDef = moddle.create(eventDefinitionType, eventDefAttrs);

  // Apply Camunda extension attributes on the event definition itself
  applyCamundaEventDefProps(eventDef, eventDefinitionType, defProps);

  // Replace existing event definitions
  bo.eventDefinitions = [eventDef];
  eventDef.$parent = bo;

  // Use modeling to trigger proper updates
  modeling.updateProperties(element, {
    eventDefinitions: bo.eventDefinitions,
  });

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    eventDefinitionType,
    message: `Set ${eventDefinitionType} on ${elementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_event_definition',
  description:
    'Add or replace an event definition on an event element (e.g. bpmn:ErrorEventDefinition, bpmn:TimerEventDefinition, bpmn:MessageEventDefinition, bpmn:SignalEventDefinition, bpmn:TerminateEventDefinition, bpmn:EscalationEventDefinition). For error events, optionally creates/references a bpmn:Error root element.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the event element',
      },
      eventDefinitionType: {
        type: 'string',
        enum: [
          'bpmn:ErrorEventDefinition',
          'bpmn:TimerEventDefinition',
          'bpmn:MessageEventDefinition',
          'bpmn:SignalEventDefinition',
          'bpmn:TerminateEventDefinition',
          'bpmn:EscalationEventDefinition',
          'bpmn:ConditionalEventDefinition',
          'bpmn:CompensateEventDefinition',
          'bpmn:CancelEventDefinition',
          'bpmn:LinkEventDefinition',
        ],
        description: 'The type of event definition to add',
      },
      properties: {
        type: 'object',
        description:
          'Type-specific properties. For Timer events, provide exactly ONE of: timeDuration (ISO 8601 duration, e.g. "PT15M" for 15 minutes, "PT1H30M" for 1.5 hours, "P1D" for 1 day), timeDate (ISO 8601 date-time, e.g. "2025-12-31T23:59:00Z"), or timeCycle (ISO 8601 repeating interval, e.g. "R3/PT10M" for 3 repetitions every 10 minutes, "R/P1D" for daily). For Conditional events: condition (expression string), variableName (restrict to specific variable), variableEvents (e.g. "create, update"). For Link events: name (link name). For Error events: errorCodeVariable (variable to store error code), errorMessageVariable (variable to store error message). For Escalation events: escalationCodeVariable (variable to store escalation code). Camunda expressions are also supported (e.g. "${myDuration}").',
        additionalProperties: true,
      },
      errorRef: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Error element ID' },
          name: { type: 'string', description: 'Error name' },
          errorCode: { type: 'string', description: 'Error code' },
          errorMessage: {
            type: 'string',
            description: 'Error message (camunda:errorMessage extension)',
          },
        },
        required: ['id'],
        description: 'For ErrorEventDefinition: creates or references a bpmn:Error root element',
      },
      messageRef: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Message element ID' },
          name: { type: 'string', description: 'Message name' },
        },
        required: ['id'],
        description:
          'For MessageEventDefinition: creates or references a bpmn:Message root element',
      },
      signalRef: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Signal element ID' },
          name: { type: 'string', description: 'Signal name' },
        },
        required: ['id'],
        description: 'For SignalEventDefinition: creates or references a bpmn:Signal root element',
      },
      escalationRef: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Escalation element ID' },
          name: { type: 'string', description: 'Escalation name' },
          escalationCode: { type: 'string', description: 'Escalation code' },
        },
        required: ['id'],
        description:
          'For EscalationEventDefinition: creates or references a bpmn:Escalation root element',
      },
    },
    required: ['diagramId', 'elementId', 'eventDefinitionType'],
  },
} as const;
