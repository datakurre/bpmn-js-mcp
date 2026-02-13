/**
 * @internal
 * Type-specific tool-discovery hints for AI callers.
 *
 * Returns a `nextSteps` object mapping element types to relevant
 * follow-up tool suggestions.  Appended to add_bpmn_element and
 * replace_bpmn_element responses.
 */

/** Hint record with a short description and the tool name to call. */
export interface Hint {
  tool: string;
  description: string;
}

/** Map from element type patterns to suggested next-step hints. */
const TYPE_HINTS: Array<{ match: (type: string) => boolean; hints: Hint[] }> = [
  {
    match: (t) => t === 'bpmn:UserTask',
    hints: [
      {
        tool: 'set_bpmn_form_data',
        description: 'Define form fields for user input',
      },
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set camunda:assignee, camunda:candidateGroups, camunda:dueDate, or camunda:formKey',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:ServiceTask',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set camunda:type="external" with camunda:topic, or camunda:class / camunda:delegateExpression for Java delegates',
      },
      {
        tool: 'set_bpmn_input_output_mapping',
        description: 'Map process variables to/from the service task',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:ScriptTask',
    hints: [
      {
        tool: 'set_bpmn_script',
        description: 'Set inline script (groovy, javascript, etc.) and optional resultVariable',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:BusinessRuleTask',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set camunda:decisionRef for DMN integration, or camunda:class for custom rule logic. For DMN, also set camunda:decisionRefBinding and camunda:mapDecisionResult.',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:CallActivity',
    hints: [
      {
        tool: 'set_bpmn_call_activity_variables',
        description: 'Map variables between parent and called process (camunda:in/out)',
      },
      {
        tool: 'set_bpmn_element_properties',
        description:
          "Set calledElement (process key) and camunda:calledElementBinding ('latest', 'deployment', 'version', 'versionTag') to control version resolution",
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:BoundaryEvent',
    hints: [
      {
        tool: 'set_bpmn_event_definition',
        description:
          'Set event type (error, timer, message, signal) if not already set via eventDefinitionType shorthand',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:SendTask',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set camunda:class, camunda:delegateExpression, or camunda:expression for message sending',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:ReceiveTask',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description: 'Configure message reference for correlation',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:ExclusiveGateway' || t === 'bpmn:InclusiveGateway',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Name the gateway as a yes/no question (e.g. "Order valid?", "Payment successful?"). Set `default` to a sequence flow ID for the default branch.',
      },
      {
        tool: 'connect_bpmn_elements',
        description:
          'Create conditional outgoing flows with conditionExpression and optional isDefault flag',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:ParallelGateway',
    hints: [
      {
        tool: 'connect_bpmn_elements',
        description:
          'Create outgoing flows for parallel branches. Parallel gateways typically don\u2019t need a name unless it adds clarity.',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:SubProcess',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set triggeredByEvent: true for event subprocesses, or isExpanded to toggle inline/collapsed view',
      },
      {
        tool: 'add_bpmn_element',
        description: 'Add start/end events and tasks inside the subprocess',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:DataObjectReference' || t === 'bpmn:DataStoreReference',
    hints: [
      {
        tool: 'connect_bpmn_elements',
        description:
          'Create a data association to connect this data element to a task (auto-detects DataInputAssociation or DataOutputAssociation based on direction)',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:Lane',
    hints: [
      {
        tool: 'create_bpmn_collaboration',
        description:
          'Consider using pools (participants) with message flows instead of lanes for cross-organizational processes. Lanes are for role-based swimlanes within a single pool.',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:IntermediateThrowEvent' || t === 'bpmn:IntermediateCatchEvent',
    hints: [
      {
        tool: 'set_bpmn_event_definition',
        description:
          'Set the event type (message, timer, signal, link, conditional, compensation). Use LinkEventDefinition for cross-page flow references in large diagrams.',
      },
    ],
  },
];

/**
 * Get type-specific next-step hints for an element type.
 * Returns `{ nextSteps: Hint[] }` if hints exist, or an empty object.
 */
export function getTypeSpecificHints(elementType: string): { nextSteps?: Hint[] } {
  for (const entry of TYPE_HINTS) {
    if (entry.match(elementType)) {
      return { nextSteps: entry.hints };
    }
  }
  return {};
}

/** Naming convention categories for BPMN elements. */
const NAMING_CATEGORIES: Array<{ match: (t: string) => boolean; convention: string }> = [
  {
    match: (t) => t.includes('Task') || t === 'bpmn:CallActivity',
    convention:
      'Use verb-object pattern (e.g. "Process Order", "Send Invoice", "Review Application")',
  },
  {
    match: (t) => t.includes('Event') && !t.includes('Gateway'),
    convention:
      'Use object-participle or noun-state pattern (e.g. "Order Received", "Payment Completed", "Timeout Reached")',
  },
  {
    match: (t) => t === 'bpmn:ExclusiveGateway' || t === 'bpmn:InclusiveGateway',
    convention:
      'Use a yes/no question ending with "?" (e.g. "Order valid?", "Payment successful?")',
  },
];

/**
 * Get a naming convention reminder when an element is created without a name.
 * Returns `{ namingHint: string }` if applicable, or an empty object.
 */
export function getNamingHint(elementType: string, name?: string): { namingHint?: string } {
  if (name) return {};
  // Parallel gateways typically don't need naming
  if (elementType === 'bpmn:ParallelGateway') return {};
  for (const entry of NAMING_CATEGORIES) {
    if (entry.match(elementType)) {
      return { namingHint: entry.convention };
    }
  }
  return {};
}
