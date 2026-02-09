/**
 * Custom bpmnlint rule: exclusive-gateway-marker
 *
 * Warns when bpmn:ExclusiveGateway shapes lack `isMarkerVisible="true"` in
 * their DI, which produces a blank diamond instead of the X marker. Best
 * practice says to always show the XOR marker for clarity.
 *
 * Since DI is not accessible from the business object in bpmn-js >= 7.x,
 * this rule walks up to bpmn:Definitions and scans the BPMNPlane for the
 * matching BPMNShape element.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:ExclusiveGateway')) return;

    // Walk up to bpmn:Definitions to find the DI shape
    let defs = node;
    while (defs && defs.$type !== 'bpmn:Definitions' && defs.$parent) {
      defs = defs.$parent;
    }
    if (!defs || defs.$type !== 'bpmn:Definitions' || !defs.diagrams) return;

    for (const diagram of defs.diagrams) {
      const plane = diagram.plane;
      if (!plane || !plane.planeElement) continue;
      for (const pe of plane.planeElement) {
        if (pe.bpmnElement === node && pe.$type === 'bpmndi:BPMNShape') {
          if (pe.isMarkerVisible !== true) {
            reporter.report(
              node.id,
              `Exclusive gateway should show the "X" marker — set isMarkerVisible="true" in DI for clarity`
            );
          }
          return;
        }
      }
    }
  }

  return { check };
}

export default ruleFactory;
