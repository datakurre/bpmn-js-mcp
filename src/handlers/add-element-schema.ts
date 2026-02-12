/**
 * JSON Schema for the add_bpmn_element tool.
 *
 * Extracted from add-element.ts (R1.5) to keep the handler logic readable.
 * The schema is ~180 lines — over half the original file.
 */

export const TOOL_DEFINITION = {
  name: 'add_bpmn_element',
  description:
    'Add an element (task, gateway, event, etc.) to a BPMN diagram. Supports boundary events via hostElementId and auto-positioning via afterElementId. When afterElementId is used, downstream elements are automatically shifted right to prevent overlap. Generates descriptive element IDs when a name is provided (e.g. UserTask_EnterName, Gateway_HasSurname). Naming best practices: tasks → verb-object ("Process Order", "Send Invoice"), events → object-participle or noun-state ("Order Received", "Payment Completed"), gateways → yes/no question ending with "?" ("Order valid?", "Payment successful?"). **⚠ Boundary events:** To attach a boundary event to a task or subprocess, use elementType=bpmn:BoundaryEvent together with hostElementId. Do NOT use bpmn:IntermediateCatchEvent for error/timer/signal boundary events — that creates a standalone event that is not attached to any host and will fail validation. After adding the boundary event, use set_bpmn_event_definition to set its type (error, timer, message, signal). **Subprocesses:** By default, bpmn:SubProcess is created **expanded** (large 350×200 shape with inline children). Set isExpanded=false for a collapsed subprocess (small shape with a separate drilldown plane). **Modeling guidance:** For simple integrations with external systems (fire-and-forget or request-response), prefer bpmn:ServiceTask (with camunda:type="external" and camunda:topic). Use message throw/catch events when modeling explicit message exchanges with collapsed partner pools in a collaboration diagram — in Camunda 7, only one pool is executable, the others are collapsed documentation of message endpoints. For **event subprocesses** (interrupt or non-interrupt handlers that can trigger at any point during the parent process, e.g. timeout handling, cancellation), create a bpmn:SubProcess and then use set_bpmn_element_properties to set triggeredByEvent to true. The event subprocess needs its own start event with an event definition (timer, message, error, signal). Prefer event subprocesses over boundary events when the exception handling spans multiple activities or applies to the whole process scope.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID returned from create_bpmn_diagram',
      },
      elementType: {
        type: 'string',
        enum: [
          'bpmn:StartEvent',
          'bpmn:EndEvent',
          'bpmn:Task',
          'bpmn:UserTask',
          'bpmn:ServiceTask',
          'bpmn:ScriptTask',
          'bpmn:ManualTask',
          'bpmn:BusinessRuleTask',
          'bpmn:SendTask',
          'bpmn:ReceiveTask',
          'bpmn:CallActivity',
          'bpmn:ExclusiveGateway',
          'bpmn:ParallelGateway',
          'bpmn:InclusiveGateway',
          'bpmn:EventBasedGateway',
          'bpmn:IntermediateCatchEvent',
          'bpmn:IntermediateThrowEvent',
          'bpmn:BoundaryEvent',
          'bpmn:SubProcess',
          'bpmn:TextAnnotation',
          'bpmn:DataObjectReference',
          'bpmn:DataStoreReference',
          'bpmn:Group',
          'bpmn:Participant',
          'bpmn:Lane',
        ],
        description: 'The type of BPMN element to add',
      },
      name: {
        type: 'string',
        description: 'The name/label for the element',
      },
      x: {
        type: 'number',
        description: 'X coordinate for the element (default: 100)',
      },
      y: {
        type: 'number',
        description: 'Y coordinate for the element (default: 100)',
      },
      isExpanded: {
        type: 'boolean',
        description:
          'For bpmn:SubProcess only: true = expanded subprocess (large, inline children on same plane, 350×200), ' +
          'false = collapsed subprocess (small, separate drilldown plane, 100×80). Default: true.',
      },
      hostElementId: {
        type: 'string',
        description:
          'For boundary events: the ID of the host element (task/subprocess) to attach to',
      },
      afterElementId: {
        type: 'string',
        description:
          'Place the new element to the right of this element (auto-positions x/y). Overrides explicit x/y.',
      },
      flowId: {
        type: 'string',
        description:
          'Insert the element into an existing sequence flow, splitting the flow and reconnecting automatically. ' +
          "The new element is positioned at the midpoint between the flow's source and target. " +
          'When set, other positioning parameters (x, y, afterElementId) are ignored.',
      },
      autoConnect: {
        type: 'boolean',
        description:
          'When afterElementId is set, automatically create a sequence flow from the reference element ' +
          'to the new element. Default: true. Set to false to skip auto-connection.',
      },
      participantId: {
        type: 'string',
        description:
          'For collaboration diagrams: the ID of the participant (pool) to add the element into. If omitted, uses the first participant or process.',
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
        description:
          'Shorthand: set an event definition on the new element in one call. ' +
          'Combines add_bpmn_element + set_bpmn_event_definition. ' +
          'Especially useful for boundary events.',
      },
      eventDefinitionProperties: {
        type: 'object',
        description:
          'Properties for the event definition (e.g. timeDuration, timeDate, timeCycle for timers, condition for conditional).',
        additionalProperties: true,
      },
      errorRef: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          errorCode: { type: 'string' },
        },
        required: ['id'],
        description: 'For ErrorEventDefinition: creates or references a bpmn:Error root element.',
      },
      messageRef: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
        description:
          'For MessageEventDefinition: creates or references a bpmn:Message root element.',
      },
      signalRef: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
        description: 'For SignalEventDefinition: creates or references a bpmn:Signal root element.',
      },
      escalationRef: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          escalationCode: { type: 'string' },
        },
        required: ['id'],
        description:
          'For EscalationEventDefinition: creates or references a bpmn:Escalation root element.',
      },
    },
    required: ['diagramId', 'elementType'],
  },
} as const;
