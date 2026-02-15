/**
 * Custom bpmnlint rule: prefer-lanes-over-pools
 *
 * Warns when a collaboration has two or more expanded participants (pools)
 * that could potentially be modeled as lanes within a single pool.
 *
 * Heuristics for detection:
 * 1. Multiple expanded pools exist (collapsed pools are fine — they represent
 *    external systems per Camunda 7 pattern)
 * 2. Message flows exist between participants (indicating interaction)
 *
 * This is distinct from `multiple-expanded-pools` which focuses on the Camunda 7
 * deployment constraint. This rule provides design guidance: if the participants
 * represent roles within the same organization, lanes are a better modeling choice.
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

export default function preferLanesOverPools() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Collaboration')) return;

    const participants = node.participants || [];
    if (participants.length < 2) return;

    const definitions = node.$parent;

    // Find all expanded participants
    const expandedParticipants = participants.filter((p: any) => isExpanded(p.id, definitions));

    if (expandedParticipants.length < 2) return;

    // Check if message flows exist (any direction)
    const messageFlows = node.messageFlows || [];
    if (messageFlows.length === 0) return;

    const names = expandedParticipants.map((p: any) => `"${p.name || p.id}"`).join(', ');
    reporter.report(
      node.id,
      `Collaboration has ${expandedParticipants.length} expanded pools (${names}) ` +
        'connected by message flows. If these represent roles within the same organization ' +
        '(e.g. "Customer" and "Support Agent"), consider using lanes within a single pool instead. ' +
        'Lanes model role separation within one process; pools model separate organizations or systems. ' +
        'Use create_bpmn_lanes to add lanes, or wrap_bpmn_process_in_collaboration with collapsed pools ' +
        'for external system endpoints.'
    );
  }

  return { check };
}
