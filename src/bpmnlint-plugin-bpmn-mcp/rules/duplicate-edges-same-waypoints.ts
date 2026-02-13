/**
 * Custom bpmnlint rule: duplicate-edges-same-waypoints
 *
 * Warns when two or more sequence flows connect the same source and target
 * elements. Duplicate flows are almost always accidental and can cause
 * confusion — the process engine will take all outgoing flows from a
 * parallel gateway or raise ambiguity on exclusive gateways.
 *
 * Note: Multiple sequence flows between the same pair are valid BPMN when
 * leaving a parallel gateway (all are taken), but even then duplicates
 * with identical conditions/semantics are suspicious. This rule flags
 * all duplicates and lets the modeler decide.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

export default function duplicateEdgesSameWaypoints() {
  function check(node: any, reporter: any) {
    // Only check at process / subprocess level
    if (!isType(node, 'bpmn:Process') && !isType(node, 'bpmn:SubProcess')) return;

    const flowElements = node.flowElements || [];

    // Collect all sequence flows grouped by source→target pair
    const edgesByPair = new Map<string, any[]>();

    for (const el of flowElements) {
      if (!isType(el, 'bpmn:SequenceFlow')) continue;

      const sourceId = el.sourceRef?.id;
      const targetId = el.targetRef?.id;
      if (!sourceId || !targetId) continue;

      const key = `${sourceId}→${targetId}`;
      if (!edgesByPair.has(key)) {
        edgesByPair.set(key, []);
      }
      edgesByPair.get(key)!.push(el);
    }

    // Report duplicates (all after the first occurrence)
    for (const [, flows] of edgesByPair) {
      if (flows.length <= 1) continue;

      for (let i = 1; i < flows.length; i++) {
        const flow = flows[i];
        const sourceName = flow.sourceRef?.name || flow.sourceRef?.id || '?';
        const targetName = flow.targetRef?.name || flow.targetRef?.id || '?';
        reporter.report(
          flow.id,
          `Duplicate sequence flow from "${sourceName}" to "${targetName}" — ` +
            `${flows.length} flows connect the same source and target. ` +
            `Remove the duplicate with delete_bpmn_element.`
        );
      }
    }
  }

  return { check };
}
