/**
 * Custom bpmnlint rule: multiple-expanded-pools
 *
 * Warns when a collaboration has more than one expanded participant (pool).
 * In Camunda 7 / Operaton, only one pool can be deployed and executed.
 * Additional pools should be collapsed (no internal flow elements) and
 * exist solely to document message flow endpoints.
 *
 * Valid pattern:
 *   Pool A (expanded, executable) ←→ Pool B (collapsed, documentation-only)
 *
 * Invalid pattern:
 *   Pool A (expanded, executable) ←→ Pool B (expanded, has flow elements)
 *
 * Detection uses the BPMN DI (diagram interchange) — checks the
 * `isExpanded` attribute on each participant's BPMNShape.  Participants
 * without a BPMNShape or with `isExpanded` not explicitly set to `false`
 * are treated as expanded (the BPMN 2.0 default).
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

/**
 * Check the BPMNShape DI to determine if a participant is expanded.
 *
 * Walks the definitions → diagrams → plane → planeElement tree to find
 * the BPMNShape for the given participant.  Returns true if expanded
 * (or if DI info is unavailable — safe default per BPMN 2.0 spec).
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
  return true; // Default per BPMN spec
}

export default function multipleExpandedPools() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Collaboration')) return;

    const participants = node.participants || [];
    if (participants.length < 2) return;

    const definitions = node.$parent;
    const expanded = participants.filter((p: any) => isExpanded(p.id, definitions));

    if (expanded.length <= 1) return;

    // Check how many expanded pools have isExecutable=true on their process
    const executablePools = expanded.filter(
      (p: any) => p.processRef && p.processRef.isExecutable === true
    );

    const names = expanded.map((p: any) => `"${p.name || p.id}"`).join(', ');

    if (executablePools.length > 1) {
      // Multiple executable expanded pools — strong signal they should be lanes
      const execNames = executablePools.map((p: any) => `"${p.name || p.id}"`).join(', ');
      reporter.report(
        node.id,
        `${executablePools.length} expanded pools are marked isExecutable (${execNames}). ` +
          'In Camunda 7 / Operaton, only one pool can be deployed and executed. ' +
          'If these represent roles within the same organization, convert to lanes within a single pool ' +
          'using convert_bpmn_collaboration_to_lanes. Otherwise, make non-executable pools collapsed ' +
          '(set collapsed: true).'
      );
    } else {
      // Multiple expanded pools but not all executable
      reporter.report(
        node.id,
        `${expanded.length} expanded pools found (${names}). ` +
          'In Camunda 7 / Operaton, only one pool can be deployed and executed. ' +
          'Make non-executable pools collapsed (set collapsed: true in create_bpmn_participant) — ' +
          'collapsed pools have no internal flow and exist only to document message flow endpoints.'
      );
    }
  }

  return { check };
}
