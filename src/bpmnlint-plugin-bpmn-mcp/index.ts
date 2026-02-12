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
import laneUsage from './rules/lane-usage';
import exclusiveGatewayMarker from './rules/exclusive-gateway-marker';
import compensationMissingAssociation from './rules/compensation-missing-association';
import boundaryEventScope from './rules/boundary-event-scope';
import loopWithoutLimit from './rules/loop-without-limit';
import multipleExpandedPools from './rules/multiple-expanded-pools';
import exclusiveGatewayConditions from './rules/exclusive-gateway-conditions';
import parallelGatewayMergeExclusive from './rules/parallel-gateway-merge-exclusive';
import userTaskMissingAssignee from './rules/user-task-missing-assignee';
import implicitMerge from './rules/implicit-merge';

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
  'lane-usage': laneUsage,
  'exclusive-gateway-marker': exclusiveGatewayMarker,
  'compensation-missing-association': compensationMissingAssociation,
  'boundary-event-scope': boundaryEventScope,
  'loop-without-limit': loopWithoutLimit,
  'multiple-expanded-pools': multipleExpandedPools,
  'exclusive-gateway-conditions': exclusiveGatewayConditions,
  'parallel-gateway-merge-exclusive': parallelGatewayMergeExclusive,
  'user-task-missing-assignee': userTaskMissingAssignee,
  'implicit-merge': implicitMerge,
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
      'bpmn-mcp/lane-usage': 'info',
      'bpmn-mcp/exclusive-gateway-marker': 'info',
      'bpmn-mcp/compensation-missing-association': 'error',
      'bpmn-mcp/boundary-event-scope': 'warn',
      'bpmn-mcp/loop-without-limit': 'warn',
      'bpmn-mcp/multiple-expanded-pools': 'warn',
      'bpmn-mcp/exclusive-gateway-conditions': 'error',
      'bpmn-mcp/parallel-gateway-merge-exclusive': 'warn',
      'bpmn-mcp/user-task-missing-assignee': 'warn',
      'bpmn-mcp/implicit-merge': 'error',
    },
  },
};
