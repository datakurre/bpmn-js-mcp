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
  'bpmn-mcp/parallel-gateway-balance':
    'The parallel split gateway{elementRef} has branches that do not reach the join gateway. Connect all branches to the join using connect_bpmn_elements, or use an inclusive gateway if branches are optional',
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
    'Remove the empty participant{elementRef} with delete_bpmn_element, or add process elements to it. If it represents an external system, collapse it with set_bpmn_element_properties { isExpanded: false } on the participant ID',
  'bpmn-mcp/lane-zigzag-flow':
    'Consider moving the element{elementRef} to the same lane as its predecessor and successor using move_bpmn_element with laneId, or restructure the process to avoid unnecessary lane crossings',
  'bpmn-mcp/gateway-pair-mismatch':
    'Add a matching join gateway of the same type downstream{elementRef}. Pair split/join gateways for readability — use add_bpmn_element to add the join gateway',
  'bpmn-mcp/boundary-event-scope':
    'Consider replacing the boundary event{elementRef} with an event subprocess (bpmn:SubProcess with triggeredByEvent: true) for process-wide scope coverage',
  'bpmn-mcp/user-task-missing-assignee':
    'Use set_bpmn_element_properties to set camunda:assignee, camunda:candidateUsers, or camunda:candidateGroups{elementRef}',
  'bpmn-mcp/implicit-merge':
    'Insert a merge gateway before element{elementRef}: (1) use add_bpmn_element with flowId set to one of the incoming flow IDs to insert a bpmn:ExclusiveGateway or bpmn:ParallelGateway inline, then (2) reconnect the remaining incoming flow(s) to the new gateway with connect_bpmn_elements.',
  'bpmn-mcp/undefined-variable':
    'Ensure variable{elementRef} is defined upstream via a form field, output parameter, script result variable, or call activity out-mapping before it is referenced',
  'bpmn-mcp/lane-crossing-excessive':
    'Reorganize tasks into lanes to reduce cross-lane flows. Use move_bpmn_element with laneId to move elements between lanes',
  'bpmn-mcp/lane-missing-start-or-end':
    'Assign start and end events to appropriate lanes using move_bpmn_element with laneId',
  'bpmn-mcp/pool-size-insufficient':
    'Use autosize_bpmn_pools_and_lanes with participantId to auto-resize the pool{elementRef}, or use move_bpmn_element with width/height to manually resize',
  'bpmn-mcp/subprocess-expansion-issue':
    'Use move_bpmn_element with width/height to resize the subprocess{elementRef}, or run layout_bpmn_diagram to re-arrange elements',
  'bpmn-mcp/lane-overcrowding':
    'Redistribute elements across lanes using move_bpmn_element with laneId, or split the lane into more specific roles using create_bpmn_lanes',
  'bpmn-mcp/role-mismatch-with-lane':
    'Use set_bpmn_element_properties to update camunda:assignee or camunda:candidateGroups to match the lane role, or move the element to the correct lane with move_bpmn_element{elementRef}',
  'bpmn-mcp/inconsistent-assignee-grouping':
    'Group elements with the same assignee/candidateGroups into a single lane using redistribute_bpmn_elements_across_lanes (strategy: manual) or move_bpmn_element with laneId',
  'bpmn-mcp/service-task-missing-implementation':
    'Use set_bpmn_element_properties to set camunda:class, camunda:delegateExpression, camunda:expression, or camunda:type="external" with camunda:topic{elementRef}',
  'bpmn-mcp/timer-missing-definition':
    'Use set_bpmn_event_definition with timeDuration, timeDate, or timeCycle to configure the timer trigger{elementRef}',
  'bpmn-mcp/call-activity-missing-called-element':
    'Use set_bpmn_element_properties to set calledElement on the call activity{elementRef}',
  'bpmn-mcp/event-subprocess-missing-trigger':
    'Use set_bpmn_event_definition to add a trigger (timer, message, error, signal) to the event subprocess start event{elementRef}',
  'bpmn-mcp/empty-subprocess':
    'Add flow elements inside the subprocess{elementRef} using add_bpmn_element, or remove it with delete_bpmn_element',
  'bpmn-mcp/dangling-boundary-event':
    'Connect the boundary event{elementRef} to a downstream element using connect_bpmn_elements, or remove it with delete_bpmn_element',
  'bpmn-mcp/receive-task-missing-message':
    'Use manage_bpmn_root_elements to create a message definition, then set_bpmn_element_properties to assign messageRef{elementRef}',
  'bpmn-mcp/lane-without-assignments':
    'Assign elements to the lane using redistribute_bpmn_elements_across_lanes (strategy: manual), or remove the empty lane with delete_bpmn_element{elementRef}',
  'bpmn-mcp/collaboration-pattern-mismatch':
    'Review the collaboration structure. In Camunda 7 / Operaton, use one expanded executable pool with collapsed partner pools for external systems',
  'bpmn-mcp/message-flow-crossing-excessive':
    'Reorder participants or reposition elements to reduce message flow crossings. Use move_bpmn_element or layout_bpmn_diagram',
  'bpmn-mcp/layout-needs-alignment':
    'Run layout_bpmn_diagram to auto-arrange elements, or use align_bpmn_elements to align specific groups{elementRef}',
  'bpmn-mcp/missing-di-shape':
    'Run layout_bpmn_diagram to regenerate diagram layout including missing DI shapes, or re-export with export_bpmn{elementRef}',
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
