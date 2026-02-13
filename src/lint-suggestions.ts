/**
 * Shared lint fix suggestion generation.
 *
 * Extracted from validate.ts so that both the validate handler and
 * the implicit `appendLintFeedback()` in linter.ts can enrich lint
 * issues with actionable fix suggestions.
 */

import type { FlatLintIssue } from './bpmnlint-types';

/**
 * Lookup table mapping lint rule names to fix suggestion templates.
 * `{elementRef}` is replaced with the element reference at runtime.
 * `{diagramId}` is replaced with the diagram ID.
 */
export const FIX_SUGGESTIONS: Record<string, string> = {
  'label-required': 'Use set_bpmn_element_properties to set a descriptive name{elementRef}',
  'bpmn-mcp/naming-convention':
    'Use set_bpmn_element_properties to set a descriptive name{elementRef}',
  'no-disconnected': 'Use connect_bpmn_elements to connect the disconnected element{elementRef}',
  'start-event-required': 'Use add_bpmn_element to add a bpmn:StartEvent to diagram "{diagramId}"',
  'end-event-required': 'Use add_bpmn_element to add a bpmn:EndEvent to diagram "{diagramId}"',
  'bpmn-mcp/gateway-missing-default':
    'Use connect_bpmn_elements with isDefault: true to set a default flow{elementRef}',
  'bpmn-mcp/implicit-split':
    'Replace conditional flows with an explicit gateway{elementRef} — add a bpmn:ExclusiveGateway after the task',
  'bpmn-mcp/backward-sequence-flow':
    'Use layout_bpmn_diagram to re-arrange elements left-to-right, or restructure the flow{elementRef}',
  'bpmn-mcp/lane-usage':
    'Consider using create_bpmn_collaboration with separate pools instead of lanes',
  'bpmn-mcp/camunda-topic-without-external-type':
    'Use set_bpmn_element_properties to set camunda:type to "external"{elementRef}',
  'bpmn-mcp/loop-without-limit':
    'Use set_bpmn_loop_characteristics to set a completionCondition or loopMaximum{elementRef}',
  'bpmn-mcp/compensation-missing-association':
    'Use connect_bpmn_elements to associate the compensation boundary event with a compensation handler{elementRef}',
  'bpmn-mcp/multiple-expanded-pools':
    'In Camunda 7 / Operaton, only one pool can be executed. Recreate non-executable pools with collapsed: true in create_bpmn_collaboration, or delete the extra expanded pool and use bpmn:ServiceTask (camunda:type="external") instead',
  'no-implicit-start':
    'Element{elementRef} has no incoming sequence flow. Connect it with connect_bpmn_elements or verify it should be a start event',
  'no-implicit-end':
    'Element{elementRef} has no outgoing sequence flow. Connect it with connect_bpmn_elements or verify it should be an end event',
  'single-blank-start-event':
    'Process should have exactly one blank start event. Remove extra start events with delete_bpmn_element or add event definitions with set_bpmn_event_definition',
  'bpmn-mcp/exclusive-gateway-conditions':
    'Exclusive gateway{elementRef} has outgoing flows without conditions. Use set_bpmn_element_properties with conditionExpression on the sequence flows, or mark one as default with isDefault: true',
  'bpmn-mcp/parallel-gateway-merge-exclusive':
    'A parallel gateway is merging mutually exclusive paths{elementRef}. Replace with an exclusive gateway using replace_bpmn_element',
  'camunda-compat/history-time-to-live':
    'Set historyTimeToLive on the process. Use set_bpmn_element_properties on the process element with camunda:historyTimeToLive',
  'bpmn-mcp/no-duplicate-named-flow-nodes':
    'Remove the duplicate element{elementRef} with delete_bpmn_element, or rename it with set_bpmn_element_properties',
  'bpmn-mcp/collaboration-participant-missing-processref':
    'The expanded participant{elementRef} has no process reference. Recreate it properly with create_bpmn_collaboration, or set it to collapsed if it is a documentation-only partner pool',
  'bpmn-mcp/collaboration-multiple-participants-no-messageflows':
    'Add message flows between pools using connect_bpmn_elements to document message exchanges between participants',
  'bpmn-mcp/elements-outside-participant-bounds':
    'Reposition element{elementRef} inside its pool using move_bpmn_element, or run layout_bpmn_diagram to re-arrange all elements',
};

/**
 * Generate a fix suggestion for a lint issue based on its rule name.
 * Returns a human-readable suggestion or undefined if no fix is applicable.
 */
export function suggestFix(issue: FlatLintIssue, diagramId: string): string | undefined {
  const { rule, elementId } = issue;
  if (!rule) return undefined;

  const template = FIX_SUGGESTIONS[rule];
  if (!template) return undefined;

  const elementRef = elementId ? ` on element "${elementId}"` : '';
  return template.replace(/{elementRef}/g, elementRef).replace(/{diagramId}/g, diagramId);
}
