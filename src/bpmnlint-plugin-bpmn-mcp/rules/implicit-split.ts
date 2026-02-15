/**
 * Custom bpmnlint rule: implicit-split
 *
 * Detects activities (tasks, subprocesses, call activities) with multiple
 * conditional outgoing sequence flows but no explicit gateway. Best practice
 * mandates using gateways for all branching decisions — implicit splits
 * make the process harder to read and reason about.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    // Only check activities (tasks, subprocesses, call activities)
    if (
      !isType(node, 'bpmn:Task') &&
      !isType(node, 'bpmn:SubProcess') &&
      !isType(node, 'bpmn:CallActivity')
    ) {
      return;
    }

    const outgoing = node.outgoing || [];
    if (outgoing.length < 2) return;

    // Check if any outgoing flow has a condition
    const conditionalFlows = outgoing.filter((flow: any) => flow.conditionExpression);

    if (conditionalFlows.length > 0) {
      reporter.report(
        node.id,
        `Activity has ${outgoing.length} outgoing flows (${conditionalFlows.length} conditional) — ` +
          `use an explicit gateway for branching decisions`
      );
    }
  }

  return { check };
}

export default ruleFactory;
