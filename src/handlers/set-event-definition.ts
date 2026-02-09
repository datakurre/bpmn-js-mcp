/**
 * Handler for set_event_definition tool.
 */

import { type SetEventDefinitionArgs, type ToolResult } from '../types';
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
} from './helpers';
import { appendLintFeedback } from '../linter';

// eslint-disable-next-line complexity, max-lines-per-function
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

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const moddle = diagram.modeler.get('moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  // Verify element is an event type
  if (!bo.$type.includes('Event')) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Element ${elementId} is not an event (type: ${bo.$type})`
    );
  }

  // Create the event definition
  const eventDefAttrs: Record<string, any> = {};

  // Handle timer-specific properties with validation
  if (eventDefinitionType === 'bpmn:TimerEventDefinition') {
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
    if (defProps.timeDuration) {
      eventDefAttrs.timeDuration = moddle.create('bpmn:FormalExpression', {
        body: defProps.timeDuration,
      });
    }
    if (defProps.timeDate) {
      eventDefAttrs.timeDate = moddle.create('bpmn:FormalExpression', {
        body: defProps.timeDate,
      });
    }
    if (defProps.timeCycle) {
      eventDefAttrs.timeCycle = moddle.create('bpmn:FormalExpression', {
        body: defProps.timeCycle,
      });
    }
  }

  // Handle conditional-specific properties
  if (eventDefinitionType === 'bpmn:ConditionalEventDefinition') {
    if (defProps.condition) {
      eventDefAttrs.condition = moddle.create('bpmn:FormalExpression', {
        body: defProps.condition,
      });
    }
  }

  // Handle link-specific properties
  if (eventDefinitionType === 'bpmn:LinkEventDefinition') {
    if (defProps.name) {
      eventDefAttrs.name = defProps.name;
    }
  }

  // Handle error reference
  if (eventDefinitionType === 'bpmn:ErrorEventDefinition' && errorRef) {
    const canvas = diagram.modeler.get('canvas');
    const rootElement = canvas.getRootElement();
    const definitions = rootElement.businessObject.$parent;
    eventDefAttrs.errorRef = resolveOrCreateError(moddle, definitions, errorRef);
  }

  // Handle message reference
  if (eventDefinitionType === 'bpmn:MessageEventDefinition' && messageRef) {
    const canvas = diagram.modeler.get('canvas');
    const rootElement = canvas.getRootElement();
    const definitions = rootElement.businessObject.$parent;
    eventDefAttrs.messageRef = resolveOrCreateMessage(moddle, definitions, messageRef);
  }

  // Handle signal reference
  if (eventDefinitionType === 'bpmn:SignalEventDefinition' && signalRef) {
    const canvas = diagram.modeler.get('canvas');
    const rootElement = canvas.getRootElement();
    const definitions = rootElement.businessObject.$parent;
    eventDefAttrs.signalRef = resolveOrCreateSignal(moddle, definitions, signalRef);
  }

  // Handle escalation reference
  if (eventDefinitionType === 'bpmn:EscalationEventDefinition' && escalationRef) {
    const canvas = diagram.modeler.get('canvas');
    const rootElement = canvas.getRootElement();
    const definitions = rootElement.businessObject.$parent;
    eventDefAttrs.escalationRef = resolveOrCreateEscalation(moddle, definitions, escalationRef);
  }

  const eventDef = moddle.create(eventDefinitionType, eventDefAttrs);

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
          'Type-specific properties. For Timer events, provide exactly ONE of: timeDuration (ISO 8601 duration, e.g. "PT15M" for 15 minutes, "PT1H30M" for 1.5 hours, "P1D" for 1 day), timeDate (ISO 8601 date-time, e.g. "2025-12-31T23:59:00Z"), or timeCycle (ISO 8601 repeating interval, e.g. "R3/PT10M" for 3 repetitions every 10 minutes, "R/P1D" for daily). For Conditional events: condition (expression string). For Link events: name (link name). Camunda expressions are also supported (e.g. "${myDuration}").',
        additionalProperties: true,
      },
      errorRef: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Error element ID' },
          name: { type: 'string', description: 'Error name' },
          errorCode: { type: 'string', description: 'Error code' },
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
