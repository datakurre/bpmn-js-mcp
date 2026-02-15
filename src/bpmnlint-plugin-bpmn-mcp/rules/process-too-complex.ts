/**
 * Custom bpmnlint rule: process-too-complex
 *
 * Warns when a process contains more than a configurable number of flow
 * nodes (default: 30), suggesting decomposition via Call Activities or
 * message-based integration to keep processes maintainable.
 *
 * Counts all flow nodes: tasks, gateways, events, subprocesses, call
 * activities. Does not count sequence flows, data objects, text
 * annotations, or participants/lanes.
 */

import { isType } from '../utils';

const DEFAULT_THRESHOLD = 30;

function ruleFactory(config?: { maxFlowNodes?: number }) {
  const threshold = config?.maxFlowNodes ?? DEFAULT_THRESHOLD;

  function check(node: any, reporter: any) {
    // Only check bpmn:Process elements
    if (!isType(node, 'bpmn:Process')) return;

    const flowElements = node.flowElements || [];

    // Count flow nodes (not sequence flows, data objects, etc.)
    const flowNodes = flowElements.filter(
      (el: any) =>
        isType(el, 'bpmn:FlowNode') ||
        isType(el, 'bpmn:Task') ||
        isType(el, 'bpmn:Gateway') ||
        isType(el, 'bpmn:Event') ||
        isType(el, 'bpmn:SubProcess') ||
        isType(el, 'bpmn:CallActivity')
    );

    if (flowNodes.length > threshold) {
      reporter.report(
        node.id,
        `Process has ${flowNodes.length} flow nodes (threshold: ${threshold}) — ` +
          `consider decomposing into smaller processes using Call Activities, ` +
          `message-based integration between participants, or Link events to split ` +
          `the flow into readable sections within the same process`
      );
    }
  }

  return { check };
}

export default ruleFactory;
