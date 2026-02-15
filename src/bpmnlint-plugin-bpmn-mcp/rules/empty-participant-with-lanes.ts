/**
 * Custom bpmnlint rule: empty-participant-with-lanes
 *
 * Errors when a collaboration contains a participant (pool) that has no
 * process elements while a sibling participant has lanes. This typically
 * indicates a modeling mistake where the user intended to add lanes to
 * a single pool but accidentally created an extra empty pool instead.
 *
 * Example bad pattern:
 *   - Participant A: has lanes with tasks inside → correct
 *   - Participant B: expanded but empty, no flow elements → error
 *
 * Collapsed (documentation-only) participants are exempt since they
 * intentionally have no internal process.
 */

import { isType } from '../utils';

/**
 * Check the BPMNShape DI to determine if a participant is collapsed.
 */
function isCollapsed(participantId: string, definitions: any): boolean {
  const diagrams = definitions?.diagrams;
  if (!diagrams) return false;

  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNShape') && el.bpmnElement?.id === participantId) {
        return el.isExpanded === false;
      }
    }
  }
  return false; // Default: expanded
}

/**
 * Check if a participant's process has any flow elements (tasks, events, gateways, etc.).
 */
function hasFlowElements(participant: any): boolean {
  const process = participant.processRef;
  if (!process) return false;
  const flowElements = process.flowElements;
  return Array.isArray(flowElements) && flowElements.length > 0;
}

/**
 * Check if any participant in the collaboration has lanes.
 */
function anySiblingHasLanes(collaboration: any, excludeId: string): boolean {
  const participants = collaboration.participants || [];
  for (const p of participants) {
    if (p.id === excludeId) continue;
    const process = p.processRef;
    if (!process) continue;
    const laneSets = process.laneSets;
    if (laneSets && laneSets.length > 0) {
      for (const laneSet of laneSets) {
        if (laneSet.lanes && laneSet.lanes.length > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

export default function emptyParticipantWithLanes() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Participant')) return;

    // Skip collapsed participants — they're documentation-only
    const collaboration = node.$parent;
    const definitions = collaboration?.$parent;
    if (isCollapsed(node.id, definitions)) return;

    // Only flag if expanded and empty
    if (hasFlowElements(node)) return;

    // Only flag if a sibling participant has lanes
    if (!anySiblingHasLanes(collaboration, node.id)) return;

    reporter.report(
      node.id,
      `Participant "${node.name || node.id}" is empty while a sibling pool has lanes. ` +
        `Remove this empty pool with delete_bpmn_element, or add process elements to it. ` +
        `If it represents an external system, set it to collapsed.`
    );
  }

  return { check };
}
