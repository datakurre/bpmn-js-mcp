/**
 * bpmnlint-plugin-bpmn-mcp
 *
 * Custom bpmnlint plugin with rules specific to MCP-generated BPMN models
 * targeting Camunda 7 (Operaton).
 *
 * Rules are registered with the bpmnlint Linter via McpPluginResolver
 * in src/linter.ts, allowing config references like:
 *   { extends: ['plugin:bpmn-mcp/recommended'] }
 *   { rules: { 'bpmn-mcp/gateway-missing-default': 'error' } }
 */

import camundaTopicWithoutExternalType from './rules/camunda-topic-without-external-type';
import gatewayMissingDefault from './rules/gateway-missing-default';
import namingConvention from './rules/naming-convention';
import gatewayPairMismatch from './rules/gateway-pair-mismatch';
import backwardSequenceFlow from './rules/backward-sequence-flow';
import implicitSplit from './rules/implicit-split';
import compensationMissingAssociation from './rules/compensation-missing-association';
import boundaryEventScope from './rules/boundary-event-scope';
import loopWithoutLimit from './rules/loop-without-limit';
import multipleExpandedPools from './rules/multiple-expanded-pools';
import exclusiveGatewayConditions from './rules/exclusive-gateway-conditions';
import parallelGatewayMergeExclusive from './rules/parallel-gateway-merge-exclusive';
import parallelGatewayBalance from './rules/parallel-gateway-balance';
import userTaskMissingAssignee from './rules/user-task-missing-assignee';
import implicitMerge from './rules/implicit-merge';
import undefinedVariable from './rules/undefined-variable';
import noDuplicateNamedFlowNodes from './rules/no-duplicate-named-flow-nodes';
import collaborationParticipantMissingProcessref from './rules/collaboration-participant-missing-processref';
import collaborationMultipleParticipantsNoMessageflows from './rules/collaboration-multiple-participants-no-messageflows';
import elementsOutsideParticipantBounds from './rules/elements-outside-participant-bounds';
import duplicateEdgesSameWaypoints from './rules/duplicate-edges-same-waypoints';
import noOverlappingShapes from './rules/no-overlapping-shapes';
import unpairedLinkEvent from './rules/unpaired-link-event';
import emptyParticipantWithLanes from './rules/empty-participant-with-lanes';
import laneZigzagFlow from './rules/lane-zigzag-flow';
import processTooComplex from './rules/process-too-complex';
import collaborationTooComplex from './rules/collaboration-too-complex';
import laneCrossingExcessive from './rules/lane-crossing-excessive';
import laneMissingStartOrEnd from './rules/lane-missing-start-or-end';
import subprocessExpansionIssue from './rules/subprocess-expansion-issue';
import laneOvercrowding from './rules/lane-overcrowding';
import roleMismatchWithLane from './rules/role-mismatch-with-lane';
import laneWithoutAssignments from './rules/lane-without-assignments';
import collaborationPatternMismatch from './rules/collaboration-pattern-mismatch';
import poolSizeInsufficient from './rules/pool-size-insufficient';
import inconsistentAssigneeGrouping from './rules/inconsistent-assignee-grouping';
import messageFlowCrossingExcessive from './rules/message-flow-crossing-excessive';
import missingDiShape from './rules/missing-di-shape';
import serviceTaskMissingImplementation from './rules/service-task-missing-implementation';
import timerMissingDefinition from './rules/timer-missing-definition';
import callActivityMissingCalledElement from './rules/call-activity-missing-called-element';
import eventSubprocessMissingTrigger from './rules/event-subprocess-missing-trigger';
import emptySubprocess from './rules/empty-subprocess';
import danglingBoundaryEvent from './rules/dangling-boundary-event';
import receiveTaskMissingMessage from './rules/receive-task-missing-message';
import layoutNeedsAlignment from './rules/layout-needs-alignment';
import defaultFlowWithCondition from './rules/default-flow-with-condition';

/**
 * All custom lint rules keyed by rule name (without plugin prefix).
 * McpPluginResolver in src/linter.ts uses this map for auto-discovery,
 * so adding a new rule only requires: (1) create the rule file,
 * (2) import and add it here, (3) add to configs.recommended.
 */
export const rules: Record<string, any> = {
  'camunda-topic-without-external-type': camundaTopicWithoutExternalType,
  'gateway-missing-default': gatewayMissingDefault,
  'naming-convention': namingConvention,
  'gateway-pair-mismatch': gatewayPairMismatch,
  'backward-sequence-flow': backwardSequenceFlow,
  'implicit-split': implicitSplit,
  'compensation-missing-association': compensationMissingAssociation,
  'boundary-event-scope': boundaryEventScope,
  'loop-without-limit': loopWithoutLimit,
  'multiple-expanded-pools': multipleExpandedPools,
  'exclusive-gateway-conditions': exclusiveGatewayConditions,
  'parallel-gateway-merge-exclusive': parallelGatewayMergeExclusive,
  'parallel-gateway-balance': parallelGatewayBalance,
  'user-task-missing-assignee': userTaskMissingAssignee,
  'implicit-merge': implicitMerge,
  'undefined-variable': undefinedVariable,
  'no-duplicate-named-flow-nodes': noDuplicateNamedFlowNodes,
  'collaboration-participant-missing-processref': collaborationParticipantMissingProcessref,
  'collaboration-multiple-participants-no-messageflows':
    collaborationMultipleParticipantsNoMessageflows,
  'elements-outside-participant-bounds': elementsOutsideParticipantBounds,
  'duplicate-edges-same-waypoints': duplicateEdgesSameWaypoints,
  'no-overlapping-shapes': noOverlappingShapes,
  'unpaired-link-event': unpairedLinkEvent,
  'empty-participant-with-lanes': emptyParticipantWithLanes,
  'lane-zigzag-flow': laneZigzagFlow,
  'process-too-complex': processTooComplex,
  'collaboration-too-complex': collaborationTooComplex,
  'lane-crossing-excessive': laneCrossingExcessive,
  'lane-missing-start-or-end': laneMissingStartOrEnd,
  'subprocess-expansion-issue': subprocessExpansionIssue,
  'lane-overcrowding': laneOvercrowding,
  'role-mismatch-with-lane': roleMismatchWithLane,
  'lane-without-assignments': laneWithoutAssignments,
  'collaboration-pattern-mismatch': collaborationPatternMismatch,
  'pool-size-insufficient': poolSizeInsufficient,
  'inconsistent-assignee-grouping': inconsistentAssigneeGrouping,
  'message-flow-crossing-excessive': messageFlowCrossingExcessive,
  'missing-di-shape': missingDiShape,
  'service-task-missing-implementation': serviceTaskMissingImplementation,
  'timer-missing-definition': timerMissingDefinition,
  'call-activity-missing-called-element': callActivityMissingCalledElement,
  'event-subprocess-missing-trigger': eventSubprocessMissingTrigger,
  'empty-subprocess': emptySubprocess,
  'dangling-boundary-event': danglingBoundaryEvent,
  'receive-task-missing-message': receiveTaskMissingMessage,
  'layout-needs-alignment': layoutNeedsAlignment,
  'default-flow-with-condition': defaultFlowWithCondition,
};

export const configs = {
  recommended: {
    rules: {
      'bpmn-mcp/camunda-topic-without-external-type': 'warn',
      'bpmn-mcp/gateway-missing-default': 'warn',
      'bpmn-mcp/naming-convention': 'warn',
      'bpmn-mcp/gateway-pair-mismatch': 'warn',
      'bpmn-mcp/backward-sequence-flow': 'warn',
      'bpmn-mcp/implicit-split': 'warn',
      'bpmn-mcp/compensation-missing-association': 'error',
      'bpmn-mcp/boundary-event-scope': 'warn',
      'bpmn-mcp/loop-without-limit': 'warn',
      'bpmn-mcp/multiple-expanded-pools': 'warn',
      'bpmn-mcp/exclusive-gateway-conditions': 'error',
      'bpmn-mcp/parallel-gateway-merge-exclusive': 'warn',
      'bpmn-mcp/parallel-gateway-balance': 'warn',
      'bpmn-mcp/user-task-missing-assignee': 'warn',
      'bpmn-mcp/implicit-merge': 'error',
      'bpmn-mcp/undefined-variable': 'warn',
      'bpmn-mcp/no-duplicate-named-flow-nodes': 'warn',
      'bpmn-mcp/collaboration-participant-missing-processref': 'warn',
      'bpmn-mcp/collaboration-multiple-participants-no-messageflows': 'warn',
      'bpmn-mcp/elements-outside-participant-bounds': 'warn',
      'bpmn-mcp/duplicate-edges-same-waypoints': 'warn',
      'bpmn-mcp/no-overlapping-shapes': 'warn',
      'bpmn-mcp/unpaired-link-event': 'warn',
      'bpmn-mcp/empty-participant-with-lanes': 'error',
      'bpmn-mcp/lane-zigzag-flow': 'warn',
      'bpmn-mcp/process-too-complex': 'warn',
      'bpmn-mcp/collaboration-too-complex': 'warn',
      'bpmn-mcp/lane-crossing-excessive': 'warn',
      'bpmn-mcp/lane-missing-start-or-end': 'warn',
      'bpmn-mcp/subprocess-expansion-issue': 'warn',
      'bpmn-mcp/lane-overcrowding': 'warn',
      'bpmn-mcp/role-mismatch-with-lane': 'warn',
      'bpmn-mcp/lane-without-assignments': 'warn',
      'bpmn-mcp/collaboration-pattern-mismatch': 'warn',
      'bpmn-mcp/pool-size-insufficient': 'warn',
      'bpmn-mcp/inconsistent-assignee-grouping': 'warn',
      'bpmn-mcp/message-flow-crossing-excessive': 'warn',
      'bpmn-mcp/missing-di-shape': 'warn',
      'bpmn-mcp/service-task-missing-implementation': 'warn',
      'bpmn-mcp/timer-missing-definition': 'warn',
      'bpmn-mcp/call-activity-missing-called-element': 'warn',
      'bpmn-mcp/event-subprocess-missing-trigger': 'error',
      'bpmn-mcp/empty-subprocess': 'warn',
      'bpmn-mcp/dangling-boundary-event': 'warn',
      'bpmn-mcp/receive-task-missing-message': 'warn',
      'bpmn-mcp/layout-needs-alignment': 'warn',
      'bpmn-mcp/default-flow-with-condition': 'warn',
    },
  },
};
