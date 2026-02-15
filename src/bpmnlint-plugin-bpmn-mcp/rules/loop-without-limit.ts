/**
 * Custom bpmnlint rule: loop-without-limit
 *
 * Warns when a sequence flow creates a loop (backward flow) without any
 * mechanism to prevent infinite iteration.  Loops should have at least one
 * of:
 * - A timer boundary event on a task in the loop (acts as a timeout)
 * - A loop counter variable referenced in a gateway condition
 * - Multi-instance loop characteristics on a task
 * - An escalation/error boundary event that could break the loop
 *
 * Without a limit, a loop can spin indefinitely at runtime.
 */

import { isType } from '../utils';

/**
 * Detect whether a gateway that feeds back to an earlier node has any
 * limiting mechanism in the loop body.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
function hasLoopLimit(gateway: any, loopTargetId: string, maxDepth = 20): boolean {
  // Walk forward from the loop target back to the gateway, checking for limits
  const visited = new Set<string>();
  const queue: Array<{ node: any; depth: number }> = [];

  // Start from the loop target
  const loopTarget = gateway.$parent?.flowElements?.find((el: any) => el.id === loopTargetId);
  if (!loopTarget) return true; // Can't verify — don't report

  queue.push({ node: loopTarget, depth: 0 });

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (depth > maxDepth || visited.has(node.id)) continue;
    visited.add(node.id);

    // Stop if we've reached the gateway again
    if (node.id === gateway.id) continue;

    // Check for timer boundary events on tasks in the loop
    if (
      isType(node, 'bpmn:Task') ||
      isType(node, 'bpmn:UserTask') ||
      isType(node, 'bpmn:ServiceTask') ||
      isType(node, 'bpmn:ScriptTask') ||
      isType(node, 'bpmn:ManualTask') ||
      isType(node, 'bpmn:BusinessRuleTask') ||
      isType(node, 'bpmn:SendTask') ||
      isType(node, 'bpmn:ReceiveTask') ||
      isType(node, 'bpmn:SubProcess') ||
      isType(node, 'bpmn:CallActivity')
    ) {
      // Check if any boundary event on this task is a timer or error (loop-breaker)
      const parent = node.$parent;
      if (parent && parent.flowElements) {
        const boundaryEvents = parent.flowElements.filter(
          (el: any) => isType(el, 'bpmn:BoundaryEvent') && el.attachedToRef?.id === node.id
        );
        for (const be of boundaryEvents) {
          const eventDefs = be.eventDefinitions || [];
          for (const ed of eventDefs) {
            if (
              isType(ed, 'bpmn:TimerEventDefinition') ||
              isType(ed, 'bpmn:ErrorEventDefinition') ||
              isType(ed, 'bpmn:EscalationEventDefinition')
            ) {
              return true; // Has a loop-breaking mechanism
            }
          }
        }
      }

      // Check for multi-instance (has its own completion condition)
      if (node.loopCharacteristics) return true;
    }

    // Check for a script task that might increment a counter
    if (isType(node, 'bpmn:ScriptTask')) {
      return true; // Assume script tasks may implement counter logic
    }

    // Follow outgoing sequence flows
    const outgoing = node.outgoing || [];
    for (const flow of outgoing) {
      if (flow.targetRef) {
        queue.push({ node: flow.targetRef, depth: depth + 1 });
      }
    }
  }

  return false;
}

function ruleFactory() {
  // eslint-disable-next-line sonarjs/cognitive-complexity
  function check(node: any, reporter: any) {
    // Only check gateways that have backward-flowing outgoing edges
    if (!isType(node, 'bpmn:ExclusiveGateway') && !isType(node, 'bpmn:InclusiveGateway')) {
      return;
    }

    const outgoing = node.outgoing || [];
    if (outgoing.length < 2) return; // Not a decision point

    // Find backward flows (flows to elements that are "earlier" in the process)
    // We detect this by checking if any target is an ancestor in a forward traversal
    for (const flow of outgoing) {
      const target = flow.targetRef;
      if (!target) continue;

      // Check if the target has an outgoing path that eventually reaches this gateway
      // (i.e. it's a loop back)
      const visited = new Set<string>();
      const queue: Array<{ node: any; depth: number }> = [{ node: target, depth: 0 }];
      let isLoop = false;

      while (queue.length > 0 && !isLoop) {
        const { node: current, depth } = queue.shift()!;
        if (depth > 30 || visited.has(current.id)) continue;
        visited.add(current.id);

        const currentOutgoing = current.outgoing || [];
        for (const f of currentOutgoing) {
          if (f.targetRef?.id === node.id) {
            isLoop = true;
            break;
          }
          if (f.targetRef) {
            queue.push({ node: f.targetRef, depth: depth + 1 });
          }
        }
      }

      if (isLoop && !hasLoopLimit(node, target.id)) {
        const targetName = target.name || target.id;
        reporter.report(
          node.id,
          `Loop back to "${targetName}" has no limiting mechanism (timer boundary event, ` +
            `error boundary, or counter script). The loop could spin indefinitely at runtime. ` +
            `Add a timer boundary event on a task in the loop, or a counter with a maximum retry limit.`
        );
      }
    }
  }

  return { check };
}

export default ruleFactory;
