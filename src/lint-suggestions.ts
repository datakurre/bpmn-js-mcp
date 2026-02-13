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
  'bpmn-mcp/duplicate-edges-same-waypoints':
    'Remove the duplicate sequence flow{elementRef} with delete_bpmn_element',
  'bpmn-mcp/no-overlapping-shapes':
    'Reposition element{elementRef} using move_bpmn_element, or run layout_bpmn_diagram to re-arrange all elements',
  'bpmn-mcp/unpaired-link-event':
    'Add a matching link throw/catch event pair. Link events must have matching names set via set_bpmn_event_definition with properties: { name: "LinkName" }',
  'bpmn-mcp/collaboration-too-complex':
    'Decompose the collaboration into smaller, independently deployable processes. Use Call Activities or message-based integration between separate BPMN deployments, or Link events to split complex flows within a single process',
  'bpmn-mcp/process-too-complex':
    'Decompose the process into smaller subprocesses using Call Activities (add_bpmn_element with elementType "bpmn:CallActivity"), or use Link events (bpmn:IntermediateThrowEvent + bpmn:IntermediateCatchEvent with LinkEventDefinition) to split the flow into readable sections within the same process',
  'bpmn-mcp/empty-participant-with-lanes':
    'Remove the empty participant{elementRef} with delete_bpmn_element, or add process elements to it. If it represents an external system, set it to collapsed',
  'bpmn-mcp/lane-zigzag-flow':
    'Consider moving the element{elementRef} to the same lane as its predecessor and successor using move_bpmn_element with laneId, or restructure the process to avoid unnecessary lane crossings',
  'bpmn-mcp/gateway-pair-mismatch':
    'Add a matching join gateway of the same type downstream{elementRef}. Pair split/join gateways for readability — use add_bpmn_element to add the join gateway',
  'bpmn-mcp/exclusive-gateway-marker':
    'Use set_bpmn_element_properties{elementRef} or re-export the diagram to ensure isMarkerVisible is set on exclusive gateway DI shapes',
  'bpmn-mcp/boundary-event-scope':
    'Consider replacing the boundary event{elementRef} with an event subprocess (bpmn:SubProcess with triggeredByEvent: true) for process-wide scope coverage',
  'bpmn-mcp/user-task-missing-assignee':
    'Use set_bpmn_element_properties to set camunda:assignee, camunda:candidateUsers, or camunda:candidateGroups{elementRef}',
  'bpmn-mcp/implicit-merge':
    'Add an explicit merge gateway before element{elementRef} — use add_bpmn_element to insert a bpmn:ExclusiveGateway or bpmn:ParallelGateway to combine the incoming flows',
  'bpmn-mcp/undefined-variable':
    'Ensure variable{elementRef} is defined upstream via a form field, output parameter, script result variable, or call activity out-mapping before it is referenced',
  'bpmn-mcp/lanes-expected-but-missing':
    'Consider adding lanes to clarify role assignments — use add_bpmn_element with bpmn:Lane to create swimlanes within the participant',
  'bpmn-mcp/lane-crossing-excessive':
    'Reorganize tasks into lanes to reduce cross-lane flows. Use move_bpmn_element with laneId to move elements between lanes',
  'bpmn-mcp/lane-single-element':
    'Lane{elementRef} has very few elements. Consider merging it with an adjacent lane using move_bpmn_element with laneId',
  'bpmn-mcp/lane-missing-start-or-end':
    'Assign start and end events to appropriate lanes using move_bpmn_element with laneId',
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
