/**
 * JSON Schema for the set_bpmn_event_definition tool.
 *
 * Extracted from set-event-definition.ts for readability.
 */

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
      inMappings: {
        type: 'array',
        description:
          'Variable mappings to pass with a signal throw event (camunda:In on SignalEventDefinition). ' +
          'Only valid for bpmn:SignalEventDefinition. Allows passing process variables into the signal payload.',
        items: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: 'Source variable name in the throwing process',
            },
            sourceExpression: {
              type: 'string',
              description: "Expression to evaluate (e.g. '${myVar + 1}')",
            },
            target: {
              type: 'string',
              description: 'Target variable name in the catching process',
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
          },
        },
      },
    },
    required: ['diagramId', 'elementId', 'eventDefinitionType'],
    examples: [
      {
        title: 'Set a timer boundary event with a 30-minute duration',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'BoundaryEvent_Timeout',
          eventDefinitionType: 'bpmn:TimerEventDefinition',
          properties: { timeDuration: 'PT30M' },
        },
      },
      {
        title: 'Set a signal throw event with variable mappings',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'IntermediateThrowEvent_Signal',
          eventDefinitionType: 'bpmn:SignalEventDefinition',
          signalRef: { id: 'Signal_OrderCompleted', name: 'Order Completed' },
          inMappings: [
            { source: 'orderId', target: 'orderId' },
            { source: 'customerName', target: 'customerName' },
          ],
        },
      },
    ],
  },
} as const;
