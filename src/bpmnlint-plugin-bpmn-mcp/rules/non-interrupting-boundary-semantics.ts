/**
 * Custom bpmnlint rule: non-interrupting-boundary-semantics
 *
 * Warns when a non-interrupting (cancelActivity=false) timer boundary event's
 * outgoing sequence flows lead exclusively to compensation throw events or error
 * end events.
 *
 * This pattern is almost always semantically wrong: once a timeout fires, the
 * host activity should typically be CANCELLED (use an interrupting timer,
 * cancelActivity=true) rather than allowed to continue running in parallel while
 * compensation or an error is triggered.
 *
 * Correct non-interrupting usage: escalation reminders, parallel monitoring —
 * the timer fires but the host activity keeps running (e.g. "send reminder
 * email after 30 min" while the task continues).
 *
 * Wrong pattern: timer fires → compensation/error → host still running (zombie).
 */

import { isType } from '../utils';

function hasTimerEventDefinition(node: any): boolean {
  return (node.eventDefinitions || []).some((ed: any) => isType(ed, 'bpmn:TimerEventDefinition'));
}

function hasErrorEventDefinition(node: any): boolean {
  return (node.eventDefinitions || []).some((ed: any) => isType(ed, 'bpmn:ErrorEventDefinition'));
}

function hasCompensateEventDefinition(node: any): boolean {
  return (node.eventDefinitions || []).some((ed: any) =>
    isType(ed, 'bpmn:CompensateEventDefinition')
  );
}

function hasTerminateEventDefinition(node: any): boolean {
  return (node.eventDefinitions || []).some((ed: any) =>
    isType(ed, 'bpmn:TerminateEventDefinition')
  );
}

/**
 * Check whether a target node is a "wrong" destination for a non-interrupting
 * timer boundary event — meaning it stops the overall flow without cancelling
 * the host activity first.
 *
 * Targets considered wrong:
 * - bpmn:EndEvent with ErrorEventDefinition (error throw while host runs)
 * - bpmn:EndEvent with TerminateEventDefinition (terminates process while host runs)
 * - bpmn:IntermediateThrowEvent with CompensateEventDefinition (compensation while host runs)
 */
function isWrongTarget(node: any): boolean {
  if (!node) return false;
  if (isType(node, 'bpmn:EndEvent')) {
    return hasErrorEventDefinition(node) || hasTerminateEventDefinition(node);
  }
  if (isType(node, 'bpmn:IntermediateThrowEvent')) {
    return hasCompensateEventDefinition(node);
  }
  return false;
}

/**
 * Check whether ALL direct outgoing sequence flow targets from the given element
 * are "wrong" targets for a non-interrupting timer boundary event.
 *
 * NOTE: We scan the parent container's flowElements for SequenceFlows whose
 * sourceRef matches the boundary event, because bpmn-js does NOT populate the
 * `outgoing` bidirectional reference on BoundaryEvent in the moddle tree
 * returned by modeler.getDefinitions().
 *
 * Returns false (no warning) when:
 * - There are no outgoing flows (dangling event — handled by another rule)
 * - At least one target is a "normal" element (task, gateway, normal end, etc.)
 */
function allOutgoingLeadToWrongTargets(boundaryEvent: any): boolean {
  const parent = boundaryEvent.$parent;
  if (!parent) return false;

  const parentFlowElements: any[] = parent.flowElements || [];

  // Scan parent's flowElements for SequenceFlows whose sourceRef is this boundary event
  const outgoingFlows = parentFlowElements.filter(
    (el: any) =>
      isType(el, 'bpmn:SequenceFlow') &&
      (el.sourceRef === boundaryEvent || el.sourceRef?.id === boundaryEvent.id)
  );

  // No outgoing flows — dangling event; don't warn here (other rule handles it)
  if (outgoingFlows.length === 0) return false;

  for (const flow of outgoingFlows) {
    const target = flow.targetRef;
    if (!target) continue;
    if (!isWrongTarget(target)) {
      return false; // at least one normal target → pattern is OK
    }
  }

  return true; // all targets are wrong
}

function ruleFactory() {
  function check(node: any, reporter: any) {
    // Check at BoundaryEvent level — bpmnlint calls check() for every element in the tree
    if (!isType(node, 'bpmn:BoundaryEvent')) return;

    // Only care about non-interrupting boundary events (cancelActivity=false)
    // Note: cancelActivity defaults to true; false means non-interrupting (dashed border)
    if (node.cancelActivity !== false) return;

    // Only care about timer boundary events
    if (!hasTimerEventDefinition(node)) return;

    if (allOutgoingLeadToWrongTargets(node)) {
      reporter.report(
        node.id,
        'Non-interrupting timer boundary event leads exclusively to compensation throw events ' +
          'or error/terminate end events. This is almost always semantically wrong: the host ' +
          'activity continues running while compensation or an error is triggered in parallel. ' +
          'If the timeout should CANCEL the host activity, set cancelActivity=true ' +
          '(interrupting timer, solid border). ' +
          'Only use non-interrupting timers (cancelActivity=false, dashed border) when the ' +
          'host activity must keep running in parallel (e.g. escalation reminders).'
      );
    }
  }

  return { check };
}

export default ruleFactory;
