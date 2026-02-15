/**
 * @internal
 * AI-caller hints: type-specific next-step suggestions and
 * contextual property hints.
 *
 * Merged from type-hints.ts (add/replace/insert element responses)
 * and property-hints.ts (set-properties responses).
 */

// ---------------------------------------------------------------------------
// Shared hint interface
// ---------------------------------------------------------------------------

/** Hint record with a short description and the tool name to call. */
export interface Hint {
  tool: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Type-specific hints (returned by add / replace / insert element)
// ---------------------------------------------------------------------------

/** Map from element type patterns to suggested next-step hints. */
const TYPE_HINTS: Array<{ match: (type: string) => boolean; hints: Hint[] }> = [
  {
    match: (t) => t === 'bpmn:UserTask',
    hints: [
      {
        tool: 'set_bpmn_form_data',
        description:
          'Define generated form fields for user input (simple key/value fields embedded in BPMN XML, good for prototyping)',
      },
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set camunda:assignee, camunda:candidateGroups, camunda:dueDate. ' +
          'For forms: camunda:formRef (Camunda Platform Form deployed separately — use a companion form-js-mcp server if available to design the form), ' +
          'camunda:formKey (embedded:app:forms/... or external app:...), ' +
          'or camunda:formRefBinding/camunda:formRefVersion for version control.',
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
          'Primary: Set camunda:decisionRef to a DMN decision table ID (deployed separately). ' +
          "Also set camunda:decisionRefBinding ('latest'/'deployment'/'version'), " +
          "camunda:mapDecisionResult ('singleEntry'/'singleResult'/'collectEntries'/'resultList'), " +
          "and camunda:decisionRefVersion (when binding='version'). " +
          'Alternative: camunda:class or camunda:delegateExpression for custom Java rule logic.',
      },
      {
        tool: 'set_bpmn_input_output_mapping',
        description:
          'Map process variables to DMN input columns and DMN output to process variables. ' +
          'Use a companion dmn-js-mcp server (if available) to design the DMN decision table itself.',
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
        tool: 'create_bpmn_participant',
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

// ---------------------------------------------------------------------------
// Property-specific hints (returned by set-properties)
// ---------------------------------------------------------------------------

/** Hint for event subprocess triggered-by-event setup. */
function hintTriggeredByEvent(props: Record<string, any>, hints: Hint[]): void {
  if (props['triggeredByEvent'] === true) {
    hints.push({
      tool: 'add_bpmn_element',
      description:
        'Add a start event with an event definition (timer, message, error, signal) inside the event subprocess',
    });
  }
}

/** Hint for async-before on external tasks / Java delegates. */
function hintAsyncBefore(
  props: Record<string, any>,
  camundaProps: Record<string, any>,
  element: any,
  hints: Hint[]
): void {
  if (
    (camundaProps['camunda:topic'] || camundaProps['camunda:class']) &&
    !props['camunda:asyncBefore'] &&
    !element.businessObject?.asyncBefore
  ) {
    hints.push({
      tool: 'set_bpmn_element_properties',
      description:
        'Consider setting camunda:asyncBefore=true for reliable execution with external tasks or Java delegates',
    });
  }
}

/** Hint for DMN decision ref binding on BusinessRuleTask. */
function hintDmnBinding(camundaProps: Record<string, any>, elType: string, hints: Hint[]): void {
  if (
    camundaProps['camunda:decisionRef'] &&
    elType === 'bpmn:BusinessRuleTask' &&
    !camundaProps['camunda:decisionRefBinding']
  ) {
    hints.push({
      tool: 'set_bpmn_element_properties',
      description:
        "Consider setting camunda:decisionRefBinding ('latest', 'deployment', 'version') and camunda:mapDecisionResult ('singleEntry', 'singleResult', 'collectEntries', 'resultList') to control DMN evaluation behavior. When binding='version', also set camunda:decisionRefVersion.",
    });
  }
}

/** Hint for calledElementBinding on CallActivity. */
function hintCalledElementBinding(
  props: Record<string, any>,
  camundaProps: Record<string, any>,
  elType: string,
  hints: Hint[]
): void {
  if (
    (props['calledElement'] || camundaProps['camunda:calledElement']) &&
    elType === 'bpmn:CallActivity' &&
    !camundaProps['camunda:calledElementBinding']
  ) {
    hints.push({
      tool: 'set_bpmn_element_properties',
      description:
        "Consider setting camunda:calledElementBinding ('latest', 'deployment', 'version', 'versionTag') to control which version of the called process is used",
    });
  }
}

/** Hint for historyTimeToLive after setting isExecutable. */
function hintHistoryTtl(props: Record<string, any>, element: any, hints: Hint[]): void {
  if (props['isExecutable'] !== true) return;
  const bo = element.businessObject;
  const hasHttl = bo?.historyTimeToLive || bo?.$attrs?.['camunda:historyTimeToLive'];
  if (!hasHttl) {
    hints.push({
      tool: 'set_bpmn_element_properties',
      description:
        'Consider setting camunda:historyTimeToLive (e.g. "P180D") to control how long process history data is retained. Required by Camunda 7.20+ by default.',
    });
  }
}

/** Hint for formRefBinding when formRef is set. */
function hintFormRefBinding(camundaProps: Record<string, any>, hints: Hint[]): void {
  if (camundaProps['camunda:formRef'] && !camundaProps['camunda:formRefBinding']) {
    hints.push({
      tool: 'set_bpmn_element_properties',
      description:
        "Consider setting camunda:formRefBinding ('latest', 'deployment', 'version') to control which Camunda Form version is used",
    });
  }
}

/**
 * Build contextual next-step hints based on properties that were set.
 */
export function buildPropertyHints(
  props: Record<string, any>,
  camundaProps: Record<string, any>,
  element: any
): Hint[] {
  const hints: Hint[] = [];
  const elType = element.type || element.businessObject?.$type || '';

  hintTriggeredByEvent(props, hints);
  hintAsyncBefore(props, camundaProps, element, hints);
  hintDmnBinding(camundaProps, elType, hints);
  hintCalledElementBinding(props, camundaProps, elType, hints);
  hintHistoryTtl(props, element, hints);
  hintFormRefBinding(camundaProps, hints);

  return hints;
}
