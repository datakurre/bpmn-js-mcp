/**
 * Custom bpmnlint rule: message-flow-necessity
 *
 * Warns when message flows connect elements that could potentially use
 * sequence flows instead. This typically happens when two expanded pools
 * represent roles within the same organization rather than separate systems.
 *
 * Detection heuristics:
 * - Both source and target are in expanded pools (not collapsed)
 * - Both pools have executable processes
 * - Message flow connects simple tasks (not message events)
 *
 * This suggests the collaboration might be better modeled as a single pool
 * with lanes for role separation.
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

/**
 * Find the participant that owns a given element.
 */
function findParticipant(element: any, participants: any[]): any | null {
  for (const p of participants) {
    if (!p.processRef) continue;
    const flowElements = p.processRef.flowElements || [];
    for (const fe of flowElements) {
      if (fe.id === element.id) return p;
    }
  }
  return null;
}

/**
 * Check if an element is a message event (intermediate throw/catch or boundary
 * with MessageEventDefinition).
 */
function isMessageEvent(element: any): boolean {
  if (!element) return false;
  const eventDefs = element.eventDefinitions || [];
  return eventDefs.some((ed: any) => isType(ed, 'bpmn:MessageEventDefinition'));
}

export default function messageFlowNecessity() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Collaboration')) return;

    const participants = node.participants || [];
    if (participants.length < 2) return;

    const definitions = node.$parent;
    const messageFlows = node.messageFlows || [];
    if (messageFlows.length === 0) return;

    for (const mf of messageFlows) {
      const source = mf.sourceRef;
      const target = mf.targetRef;
      if (!source || !target) continue;

      // Skip if either end is a message event — those are proper message flow usage
      if (isMessageEvent(source) || isMessageEvent(target)) continue;

      // Skip if either end is a participant shape itself (collapsed pool endpoint)
      if (isType(source, 'bpmn:Participant') || isType(target, 'bpmn:Participant')) continue;

      // Find the participants owning source and target
      const sourceParticipant = findParticipant(source, participants);
      const targetParticipant = findParticipant(target, participants);
      if (!sourceParticipant || !targetParticipant) continue;

      // Both must be expanded pools with processes
      if (!isExpanded(sourceParticipant.id, definitions)) continue;
      if (!isExpanded(targetParticipant.id, definitions)) continue;
      if (!sourceParticipant.processRef || !targetParticipant.processRef) continue;

      // Both pools are expanded with executable processes — the message flow
      // might be unnecessary and could be replaced with a sequence flow in
      // a single-pool design with lanes
      const sourceName = source.name || source.id;
      const targetName = target.name || target.id;
      const sourcePool = sourceParticipant.name || sourceParticipant.id;
      const targetPool = targetParticipant.name || targetParticipant.id;

      reporter.report(
        mf.id,
        `Message flow from "${sourceName}" (pool "${sourcePool}") to "${targetName}" ` +
          `(pool "${targetPool}") connects tasks in two expanded pools. ` +
          `If these pools represent roles within the same organization, ` +
          `consider using a single pool with lanes and sequence flows instead. ` +
          `Message flows should connect separate systems or organizations.`
      );
    }
  }

  return { check };
}
