/**
 * Custom bpmnlint rule: backward-sequence-flow
 *
 * Warns when a sequence flow's target is positioned to the left of its
 * source (negative X delta), indicating a right-to-left flow that hurts
 * readability. Left-to-right modeling is a core BPMN convention.
 *
 * Uses source/target element positions rather than DI waypoints (DI is
 * not accessible from the business object in bpmn-js >= 7.x).
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

function ruleFactory() {
  // eslint-disable-next-line complexity
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:SequenceFlow')) return;

    // Use sourceRef and targetRef (moddle references to the source/target elements)
    const source = node.sourceRef;
    const target = node.targetRef;
    if (!source || !target) return;

    // Try to get positional information from the elements' DI shapes.
    // We access the definitions root to find BPMNDiagram → BPMNPlane → shapes.
    // However, in headless mode DI is managed by bpmn-js, not directly
    // on the business object. Use a heuristic: if source/target have bounds
    // via their DI shape, compare them. Otherwise, silently skip.
    let sourceX: number | undefined;
    let targetX: number | undefined;

    // Walk up to find bpmn:Definitions, then scan BPMNPlane for matching shapes
    let defs = node;
    while (defs && defs.$type !== 'bpmn:Definitions' && defs.$parent) {
      defs = defs.$parent;
    }
    if (defs && defs.$type === 'bpmn:Definitions' && defs.diagrams) {
      for (const diagram of defs.diagrams) {
        const plane = diagram.plane;
        if (!plane || !plane.planeElement) continue;
        for (const pe of plane.planeElement) {
          if (pe.bpmnElement === source && pe.bounds) {
            sourceX = pe.bounds.x;
          }
          if (pe.bpmnElement === target && pe.bounds) {
            targetX = pe.bounds.x;
          }
        }
      }
    }

    if (sourceX === undefined || targetX === undefined) return;

    const xDelta = targetX - sourceX;
    if (xDelta < -50) {
      reporter.report(
        node.id,
        `Sequence flow goes right-to-left (${Math.round(Math.abs(xDelta))}px backwards) — ` +
          `model left-to-right for readability`
      );
    }
  }

  return { check };
}

export default ruleFactory;
