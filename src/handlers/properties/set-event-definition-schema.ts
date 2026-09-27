/**
 * JSON Schema for the `eventDefinition` sub-object of set_bpmn_element_properties.
 *
 * Extracted from set-event-definition.ts to stay under max-lines. Not a
 * standalone TOOL_DEFINITION — set_bpmn_event_definition was removed outright
 * (see ADR-028), not kept as its own tool.
 */

/**
 * All BPMN event definition types this tool accepts. Lives here (not in
 * set-event-definition.ts) so that file can import it from this one without
 * a circular dependency, since this file's schema also needs it.
 */
export const EVENT_DEFINITION_TYPE_VALUES = [
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
] as const;

/** Shared `eventDefinition` sub-object schema fragment (no diagramId/elementId). */
export const EVENT_DEFINITION_SCHEMA_PROPERTIES = {
  eventDefinitionType: {
    type: 'string',
    enum: EVENT_DEFINITION_TYPE_VALUES,
    description: 'The type of event definition to add',
  },
  properties: {
    type: 'object',
    description:
      'Type-specific properties. Timer: exactly ONE of timeDuration/timeDate/timeCycle (ISO 8601, e.g. "PT15M", "R3/PT10M"). Conditional: condition, variableName, variableEvents. Link: name. Error: errorCodeVariable, errorMessageVariable. Escalation: escalationCodeVariable. Camunda expressions supported (e.g. "${myDuration}").',
    additionalProperties: true,
  },
  errorRef: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Error element ID' },
      name: { type: 'string', description: 'Error name' },
      errorCode: { type: 'string', description: 'Error code' },
      errorMessage: { type: 'string', description: 'Error message (camunda:errorMessage)' },
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
    description: 'For MessageEventDefinition: creates or references a bpmn:Message root element',
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
      'Variable mappings to pass with a signal throw event (camunda:In on SignalEventDefinition). Only valid for bpmn:SignalEventDefinition.',
    items: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source variable name in the throwing process' },
        sourceExpression: { type: 'string', description: "Expression, e.g. '${myVar + 1}'" },
        target: { type: 'string', description: 'Target variable name in the catching process' },
        variables: {
          type: 'string',
          enum: ['all'],
          description: "Set to 'all' to pass all variables",
        },
        local: { type: 'boolean', description: 'Whether to use local scope (default: false)' },
      },
    },
  },
} as const;
