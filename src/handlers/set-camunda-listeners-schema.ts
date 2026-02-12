/**
 * JSON Schema for the set_bpmn_camunda_listeners tool.
 *
 * Extracted from set-camunda-listeners.ts to keep the handler logic
 * readable and within the max-lines limit.
 */

/** Reusable field injection schema for listener items. */
const FIELD_INJECTION_SCHEMA = {
  type: 'array',
  description: 'Field injection on the listener (e.g. for configuring delegate classes)',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Field name' },
      stringValue: {
        type: 'string',
        description: 'Static string value (attribute form)',
      },
      string: {
        type: 'string',
        description: 'Static string value (child element form)',
      },
      expression: {
        type: 'string',
        description: 'Expression value (e.g. ${myBean.value})',
      },
    },
    required: ['name'],
  },
} as const;

/** Reusable inline script schema for listener items. */
const SCRIPT_SCHEMA = {
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
} as const;

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
            script: SCRIPT_SCHEMA,
            fields: FIELD_INJECTION_SCHEMA,
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
              description:
                "Listener event: 'create', 'assignment', 'complete', 'delete', or 'timeout' (requires timerEventDefinition)",
            },
            id: {
              type: 'string',
              description:
                'Optional unique ID for the task listener. Required when using timeout event with timerEventDefinition.',
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
            script: SCRIPT_SCHEMA,
            fields: FIELD_INJECTION_SCHEMA,
            timerEventDefinition: {
              type: 'object',
              description:
                "Timer definition for 'timeout' task listeners. Specifies when the listener fires if the task isn't completed in time. Provide exactly ONE of timeDuration, timeDate, or timeCycle.",
              properties: {
                timeDuration: {
                  type: 'string',
                  description:
                    "ISO 8601 duration (e.g. 'PT15M' for 15 minutes, 'PT1H' for 1 hour). Also supports expressions like '${myDuration}'.",
                },
                timeDate: {
                  type: 'string',
                  description:
                    "ISO 8601 date-time (e.g. '2025-12-31T23:59:00Z'). Also supports expressions.",
                },
                timeCycle: {
                  type: 'string',
                  description:
                    "ISO 8601 repeating interval (e.g. 'R3/PT10M' for 3 repetitions every 10 minutes).",
                },
              },
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
