/**
 * @internal
 * Contextual next-step hints for set_bpmn_element_properties responses.
 *
 * Each hint function checks a specific condition and appends a
 * tool-discovery suggestion to the hints array when relevant.
 */

/** Hint record with a short description and the tool name to call. */
interface PropertyHint {
  tool: string;
  description: string;
}

/** Hint for event subprocess triggered-by-event setup. */
function hintTriggeredByEvent(props: Record<string, any>, hints: PropertyHint[]): void {
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
  hints: PropertyHint[]
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
function hintDmnBinding(
  camundaProps: Record<string, any>,
  elType: string,
  hints: PropertyHint[]
): void {
  if (
    camundaProps['camunda:decisionRef'] &&
    elType === 'bpmn:BusinessRuleTask' &&
    !camundaProps['camunda:decisionRefBinding']
  ) {
    hints.push({
      tool: 'set_bpmn_element_properties',
      description:
        "Consider setting camunda:decisionRefBinding ('latest', 'deployment', 'version') and camunda:mapDecisionResult ('singleEntry', 'singleResult', 'collectEntries', 'resultList') to control DMN evaluation behavior",
    });
  }
}

/** Hint for calledElementBinding on CallActivity. */
function hintCalledElementBinding(
  props: Record<string, any>,
  camundaProps: Record<string, any>,
  elType: string,
  hints: PropertyHint[]
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
function hintHistoryTtl(props: Record<string, any>, element: any, hints: PropertyHint[]): void {
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
function hintFormRefBinding(camundaProps: Record<string, any>, hints: PropertyHint[]): void {
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
): PropertyHint[] {
  const hints: PropertyHint[] = [];
  const elType = element.type || element.businessObject?.$type || '';

  hintTriggeredByEvent(props, hints);
  hintAsyncBefore(props, camundaProps, element, hints);
  hintDmnBinding(camundaProps, elType, hints);
  hintCalledElementBinding(props, camundaProps, elType, hints);
  hintHistoryTtl(props, element, hints);
  hintFormRefBinding(camundaProps, hints);

  return hints;
}
