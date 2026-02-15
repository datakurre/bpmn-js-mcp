/**
 * Custom bpmnlint rule: collaboration-pattern-mismatch
 *
 * Detects when a collaboration has one executable expanded pool and another
 * expanded pool that contains only message events (start/intermediate/end
 * message events with no real tasks) or has no process at all. In Camunda 7,
 * only one pool can be deployed as executable — the second pool should
 * typically be collapsed to represent an external message endpoint.
 *
 * This rule supplements `multiple-expanded-pools` with more specific
 * guidance about when to collapse a pool vs. convert to lanes.
 *
 * Note: In headless bpmn-js, a second participant's processRef may be
 * undefined even when elements are visually placed inside it (the elements
 * exist in the diagram layer but not the semantic model). This rule handles
 * that case by treating a missing processRef as "no real tasks".
 */

import { isType } from '../utils';

/**
 * Check the BPMNShape DI to determine if a participant is expanded.
 */
function isExpanded(participantId: string, definitions: any): boolean {
  const diagrams = definitions?.diagrams;
  if (!diagrams) return true;

  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNShape') && el.bpmnElement?.id === participantId) {
        return el.isExpanded !== false;
      }
    }
  }
  return true;
}

/** Task types that indicate a process has real work, not just event routing. */
const TASK_TYPES = [
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:CallActivity',
  'bpmn:SubProcess',
];

/**
 * Check whether a process contains any real task elements.
 */
function hasRealTasks(process: any): boolean {
  const flowElements = process?.flowElements || [];
  return flowElements.some((el: any) => TASK_TYPES.some((t) => isType(el, t)));
}

export default function collaborationPatternMismatch() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Collaboration')) return;

    const participants = node.participants || [];
    if (participants.length < 2) return;

    const definitions = node.$parent;

    const expandedParticipants = participants.filter((p: any) => isExpanded(p.id, definitions));
    if (expandedParticipants.length < 2) return;

    // Check that at least one expanded participant has real tasks
    const hasPoolWithTasks = expandedParticipants.some(
      (p: any) => p.processRef && hasRealTasks(p.processRef)
    );
    if (!hasPoolWithTasks) return;

    // Flag expanded participants that have no real tasks
    for (const participant of expandedParticipants) {
      const process = participant.processRef;

      // processRef missing → no semantic process attached (headless bpmn-js quirk)
      // processRef present but no tasks → only events/gateways/flows
      const hasNoTasks = !process || !hasRealTasks(process);

      if (hasNoTasks) {
        reporter.report(
          participant.id,
          `Participant "${participant.name || participant.id}" is expanded but contains ` +
            `only message events (no tasks). In Camunda 7, only one pool is executable — ` +
            `consider collapsing this pool to represent an external message endpoint. ` +
            `Use set_bpmn_element_properties with { isExpanded: false } or redesign ` +
            `using create_bpmn_participant with collapsed: true.`
        );
      }
    }
  }

  return { check };
}
