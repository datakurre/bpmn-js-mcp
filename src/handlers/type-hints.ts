/**
 * Type-specific tool-discovery hints for AI callers.
 *
 * Returns a `nextSteps` object mapping element types to relevant
 * follow-up tool suggestions.  Appended to add_bpmn_element and
 * replace_bpmn_element responses.
 */

/** Hint record with a short description and the tool name to call. */
interface Hint {
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
          'Set camunda:decisionRef for DMN integration, or camunda:class for custom rule logic',
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
        description: 'Set calledElement (process key) and camunda:calledElementBinding',
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
