/**
 * Custom bpmnlint rule: collaboration-participant-missing-processref
 *
 * Warns when a non-collapsed participant (pool) has no processRef.
 * In valid BPMN, an expanded participant should reference a process
 * that contains its flow elements.  A missing processRef indicates
 * a modeling error (e.g., pool was created without a backing process).
 *
 * Collapsed participants (documentation-only partner pools) are exempt
 * since they intentionally have no internal process.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

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

export default function collaborationParticipantMissingProcessref() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Participant')) return;

    // Skip collapsed participants — they're documentation-only
    const collaboration = node.$parent;
    const definitions = collaboration?.$parent;
    if (isCollapsed(node.id, definitions)) return;

    // Check for processRef
    if (!node.processRef) {
      reporter.report(
        node.id,
        `Expanded participant "${node.name || node.id}" has no processRef. ` +
          `An expanded pool must reference a process. ` +
          `If this should be a documentation-only partner pool, set it to collapsed.`
      );
    }
  }

  return { check };
}
