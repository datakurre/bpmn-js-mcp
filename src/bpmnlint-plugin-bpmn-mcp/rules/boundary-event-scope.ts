/**
 * Custom bpmnlint rule: boundary-event-scope
 *
 * Warns when a message/signal boundary event on a single task is used for
 * catch-all scenarios (like cancellation) that would be better served by an
 * **event subprocess**.
 *
 * A boundary event only catches while its host task is active. If the intent
 * is to handle a message/signal at any point during the process (e.g.
 * cancellation available throughout), an interrupting event subprocess with
 * a message/signal start event covers the entire process scope.
 *
 * Heuristic: if a message boundary event leads to a flow that ends with a
 * terminal path (compensation throw, cancel end event, or error end event)
 * and the host task is NOT the last activity before the end, this is likely
 * a scope-limited cancellation pattern that should be an event subprocess.
 */

import { isType } from '../utils';

function hasEventDefinitionOfType(node: any, defType: string): boolean {
  const eventDefs = node.eventDefinitions || [];
  return eventDefs.some((ed: any) => isType(ed, defType));
}

/**
 * Walk the outgoing path from a boundary event and check if it leads to
 * a compensation throw, error end, or terminate end — indicating a
 * cancellation/abort pattern.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
function leadsToTerminalPath(boundaryEvent: any, maxDepth = 10): boolean {
  const visited = new Set<string>();
  const queue: Array<{ node: any; depth: number }> = [{ node: boundaryEvent, depth: 0 }];

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (depth > maxDepth || visited.has(node.id)) continue;
    visited.add(node.id);

    // Check if this is a terminal compensation/cancel/error pattern
    if (isType(node, 'bpmn:IntermediateThrowEvent') || isType(node, 'bpmn:EndEvent')) {
      const eventDefs = node.eventDefinitions || [];
      for (const ed of eventDefs) {
        if (
          isType(ed, 'bpmn:CompensateEventDefinition') ||
          isType(ed, 'bpmn:TerminateEventDefinition') ||
          isType(ed, 'bpmn:ErrorEventDefinition') ||
          isType(ed, 'bpmn:CancelEventDefinition')
        ) {
          return true;
        }
      }
    }

    // Check end events with "cancel" in the name
    if (isType(node, 'bpmn:EndEvent') && node.name) {
      const nameLower = node.name.toLowerCase();
      if (
        nameLower.includes('cancel') ||
        nameLower.includes('abort') ||
        nameLower.includes('terminate')
      ) {
        return true;
      }
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
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:BoundaryEvent')) return;

    // Only check message and signal boundary events (common catch-all patterns)
    const isMessage = hasEventDefinitionOfType(node, 'bpmn:MessageEventDefinition');
    const isSignal = hasEventDefinitionOfType(node, 'bpmn:SignalEventDefinition');
    if (!isMessage && !isSignal) return;

    // Check if this boundary event leads to a terminal path
    if (!leadsToTerminalPath(node)) return;

    const eventType = isMessage ? 'message' : 'signal';
    const hostName = node.attachedToRef?.name || node.attachedToRef?.id || 'unknown';

    reporter.report(
      node.id,
      `${eventType.charAt(0).toUpperCase() + eventType.slice(1)} boundary event on "${hostName}" ` +
        `leads to a cancellation/compensation path, but only catches while that task is active. ` +
        `Consider using an interrupting event subprocess with a ${eventType} start event instead — ` +
        `this covers the entire process scope, so the ${eventType} is caught regardless of which ` +
        `activity is currently running.`
    );
  }

  return { check };
}

export default ruleFactory;
