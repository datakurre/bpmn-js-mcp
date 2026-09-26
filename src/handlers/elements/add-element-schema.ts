/**
 * JSON Schema for the add_bpmn_element tool.
 *
 * Extracted from add-element.ts (R1.5) to keep the handler logic readable.
 * The schema is ~180 lines — over half the original file.
 */

export const TOOL_DEFINITION = {
  name: 'add_bpmn_element',
  description:
    'Add an element (task, gateway, event, etc.) to a BPMN diagram. ' +
    'Supports boundary events via hostElementId and auto-positioning via afterElementId. ' +
    'When afterElementId is used, downstream elements are automatically shifted right to prevent overlap. ' +
    'Generates descriptive element IDs when a name is provided (e.g. UserTask_EnterName, Gateway_HasSurname). ' +
    '**⚠ Boundary events:** Use elementType=bpmn:BoundaryEvent with hostElementId. ' +
    'Do NOT use bpmn:IntermediateCatchEvent for boundary events. ' +
    '**Subprocesses:** Default is expanded (350×200); set isExpanded=false for collapsed. ' +
    '**Cross-lane handoff:** Use fromElementId + toLaneId to place the new element in a target lane and ' +
    'auto-connect from a source element. ' +
    'See bpmn://guides/modeling-elements for naming conventions, integration patterns, and event subprocess guidance.',
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
          'Required for bpmn:BoundaryEvent: the ID of the host element (task/subprocess) to attach to. ' +
          'Boundary events are positioned relative to their host, so afterElementId and flowId are not applicable.',
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
          'When set, other positioning parameters (x, y, afterElementId) are ignored. ' +
          'Cannot be combined with afterElementId.',
      },
      autoConnect: {
        type: 'boolean',
        default: true,
        description:
          'When afterElementId is set, automatically create a sequence flow from the reference element ' +
          'to the new element. Default: true. Set to false to skip auto-connection. ' +
          'Ignored when flowId is used (flow splitting always reconnects both sides).',
      },
      participantId: {
        type: 'string',
        description:
          'For collaboration diagrams: the ID of the participant (pool) to add the element into. If omitted, uses the first participant or process.',
      },
      parentId: {
        type: 'string',
        description:
          'Place the element inside a specific parent container (SubProcess or Participant). ' +
          'Use this to add elements inside event subprocesses or regular subprocesses. ' +
          "The element will be nested in the parent's BPMN structure and positioned relative to the parent's coordinate system.",
      },
      laneId: {
        type: 'string',
        description:
          'Place the element into a specific lane (auto-centers vertically within the lane). ' +
          "The element is registered in the lane's flowNodeRef list.",
      },
      ensureUnique: {
        type: 'boolean',
        default: false,
        description:
          'When true, reject creation if another element with the same type and name already exists. ' +
          'Default: false (duplicates produce a warning but are allowed).',
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
      copyFrom: {
        type: 'string',
        description:
          'Duplicate an existing element: pass the source element ID. Copies its type, name (with " (copy)" suffix), ' +
          'and camunda properties, placing the copy at an offset from the original. Connections are not copied. ' +
          'When set, elementType is still required but used only for validation — the actual type is taken from the source.',
      },
      cancelActivity: {
        type: 'boolean',
        description:
          'For bpmn:BoundaryEvent only: false = non-interrupting (dashed border, host activity continues). ' +
          'true = interrupting (default, host activity is cancelled when event fires). ' +
          'Ignored for non-boundary event element types.',
      },
      isForCompensation: {
        type: 'boolean',
        description:
          'Mark this task/service task as a compensation handler (isForCompensation=true). ' +
          'Compensation handlers are NOT in the normal sequence flow — they are invoked only when ' +
          'a compensation boundary event fires. The response includes nextSteps guidance for the ' +
          'mandatory compensation wiring order: add BoundaryEvent → layout → connect via Association.',
      },
      fromElementId: {
        type: 'string',
        description:
          'Cross-lane handoff shorthand: the source element ID to connect from. ' +
          'When combined with toLaneId, places the new element in the target lane and ' +
          'auto-connects from this element (SequenceFlow for same-pool, MessageFlow for cross-pool). ' +
          'Both fromElementId and toLaneId must be provided together.',
      },
      toLaneId: {
        type: 'string',
        description:
          'Cross-lane handoff shorthand: the target lane ID where the new element is placed. ' +
          'When combined with fromElementId, creates a cross-lane handoff in one call. ' +
          'Both fromElementId and toLaneId must be provided together.',
      },
      connectionLabel: {
        type: 'string',
        description:
          'Optional label for the connection created during a handoff ' +
          '(when fromElementId + toLaneId are used).',
      },
    },
    required: ['diagramId', 'elementType'],
    allOf: [
      {
        if: {
          properties: { elementType: { const: 'bpmn:BoundaryEvent' } },
          required: ['elementType'],
        },
        then: {
          required: ['hostElementId'],
          properties: {
            afterElementId: { not: {} },
            flowId: { not: {} },
          },
        },
      },
      {
        not: {
          description: 'flowId and afterElementId are mutually exclusive',
          required: ['flowId', 'afterElementId'],
        },
      },
      {
        if: {
          required: ['eventDefinitionType'],
        },
        then: {
          properties: {
            elementType: {
              enum: [
                'bpmn:StartEvent',
                'bpmn:EndEvent',
                'bpmn:IntermediateCatchEvent',
                'bpmn:IntermediateThrowEvent',
                'bpmn:BoundaryEvent',
              ],
            },
          },
        },
      },
    ],
    examples: [
      {
        title: 'Attach boundary timer event to a task',
        value: {
          diagramId: '<diagram-id>',
          elementType: 'bpmn:BoundaryEvent',
          name: 'Timeout',
          hostElementId: 'UserTask_ReviewOrder',
          eventDefinitionType: 'bpmn:TimerEventDefinition',
          eventDefinitionProperties: { timeDuration: 'PT30M' },
        },
      },
      {
        title: 'Insert element into an existing sequence flow',
        value: {
          diagramId: '<diagram-id>',
          elementType: 'bpmn:UserTask',
          name: 'Approve Request',
          flowId: 'Flow_StartToEnd',
        },
      },
      {
        title: 'Add element into a specific participant pool',
        value: {
          diagramId: '<diagram-id>',
          elementType: 'bpmn:ServiceTask',
          name: 'Send Notification',
          participantId: 'Participant_ServiceDesk',
          afterElementId: 'UserTask_ReviewTicket',
        },
      },
      {
        title: 'Cross-lane handoff: add element in a lane and connect from source',
        value: {
          diagramId: '<diagram-id>',
          elementType: 'bpmn:UserTask',
          name: 'Approve Request',
          fromElementId: 'UserTask_SubmitRequest',
          toLaneId: 'Lane_Approver',
          connectionLabel: 'Submit for approval',
        },
      },
    ],
  },
} as const;
