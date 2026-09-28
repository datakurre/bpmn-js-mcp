/**
 * JSON Schema for the add_bpmn_elements tool.
 *
 * Merges the former add_bpmn_element and add_bpmn_element_chain tools (see
 * ADR-031): `elements` is always an array — a single element is an array of
 * one — and `connect` picks whether consecutive elements are auto-connected
 * ('chain', the default) or added independently ('none').
 *
 * ELEMENT_ITEM_SCHEMA_PROPERTIES holds the per-element fields (everything
 * add_bpmn_element used to accept at its top level, minus diagramId) as one
 * shared object, embedded once as `elements.items.properties` — extracted
 * from add-element-schema.ts's former TOOL_DEFINITION to stay under max-lines.
 */

const ELEMENT_TYPE_VALUES = [
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
] as const;

/** Per-element schema fragment — one entry of the `elements` array. */
export const ELEMENT_ITEM_SCHEMA_PROPERTIES = {
  elementType: {
    type: 'string',
    enum: ELEMENT_TYPE_VALUES,
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
      'Place this element to the right of this existing (or earlier-in-batch) element (auto-positions x/y) and ' +
      "auto-connect from it. Overrides explicit x/y and the batch's own chain auto-connect for this item.",
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
      'to this element. Default: true. Set to false to skip auto-connection. ' +
      'Ignored when flowId is used (flow splitting always reconnects both sides).',
  },
  participantId: {
    type: 'string',
    description:
      'For collaboration diagrams: the ID of the participant (pool) to add the element into. ' +
      'Overrides the batch-level participantId. If omitted, uses the first participant or process.',
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
      'Place the element into a specific lane (auto-centers vertically within the lane). Overrides the ' +
      "batch-level laneId. The element is registered in the lane's flowNodeRef list.",
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
      'Shorthand: set an event definition on this element in one call, combining element creation with ' +
      "set_bpmn_element_properties's eventDefinition sub-object. Especially useful for boundary events.",
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
    description: 'For MessageEventDefinition: creates or references a bpmn:Message root element.',
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
      'When combined with toLaneId, places this element in the target lane and ' +
      'auto-connects from this element (SequenceFlow for same-pool, MessageFlow for cross-pool). ' +
      'Both fromElementId and toLaneId must be provided together.',
  },
  toLaneId: {
    type: 'string',
    description:
      'Cross-lane handoff shorthand: the target lane ID where this element is placed. ' +
      'When combined with fromElementId, creates a cross-lane handoff in one call. ' +
      'Both fromElementId and toLaneId must be provided together.',
  },
  connectionLabel: {
    type: 'string',
    description:
      'Optional label for the connection created during a handoff ' +
      '(when fromElementId + toLaneId are used).',
  },
} as const;

/** Per-element `allOf` conditionals, scoped to each `elements[]` item. */
const ELEMENT_ITEM_ALL_OF = [
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
] as const;

export const TOOL_DEFINITION = {
  name: 'add_bpmn_elements',
  description:
    'Add one or more elements (task, gateway, event, etc.) to a BPMN diagram. `elements` is always an array — ' +
    'a single element is an array of one. `connect` controls how consecutive elements relate: "chain" (default) ' +
    'auto-connects each element to the previous one in sequence, reducing round-trips; ' +
    '"none" adds every element independently, using each item\'s own fields (hostElementId, flowId, ' +
    'afterElementId, x/y, etc.) for placement. An item that sets its own placement anchor (hostElementId, flowId, ' +
    'a handoff via fromElementId/toLaneId, copyFrom, or explicit x/y) is placed there instead of being ' +
    'auto-connected after the previous element, even in "chain" mode. ' +
    'Generates descriptive element IDs when a name is provided (e.g. UserTask_EnterName, Gateway_HasSurname). ' +
    '**⚠ Boundary events:** Use elementType=bpmn:BoundaryEvent with hostElementId. ' +
    'Do NOT use bpmn:IntermediateCatchEvent for boundary events. ' +
    '**Subprocesses:** Default is expanded (350×200); set isExpanded=false for collapsed. ' +
    '**Cross-lane handoff:** Use fromElementId + toLaneId to place an element in a target lane and ' +
    'auto-connect from a source element. ' +
    'See bpmn://guides/modeling-elements for naming conventions, integration patterns, and event subprocess guidance.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID returned from create_bpmn_diagram',
      },
      elements: {
        type: 'array',
        description: 'Elements to add. A single element is an array of one.',
        items: {
          type: 'object',
          properties: ELEMENT_ITEM_SCHEMA_PROPERTIES,
          required: ['elementType'],
          allOf: ELEMENT_ITEM_ALL_OF,
        },
        minItems: 1,
      },
      connect: {
        type: 'string',
        enum: ['chain', 'none'],
        default: 'chain',
        description:
          '"chain" (default): auto-connect consecutive elements in sequence, reducing round-trips. ' +
          '"none": add every element independently — no auto-connection between them.',
      },
      afterElementId: {
        type: 'string',
        description:
          'connect: "chain" only — connect the first element after this existing element. ' +
          'If omitted, the chain starts unconnected.',
      },
      participantId: {
        type: 'string',
        description: 'Default participant pool for all elements (can be overridden per element).',
      },
      laneId: {
        type: 'string',
        description: 'Default lane for all elements (can be overridden per element).',
      },
      autoLayout: {
        type: 'boolean',
        description:
          'Run layout_bpmn_diagram automatically after adding. Default: true for connect: "chain" ' +
          '(chains connect elements, so layout is almost always desired), false for connect: "none".',
      },
    },
    required: ['diagramId', 'elements'],
  },
} as const;
