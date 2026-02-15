/**
 * Custom bpmnlint rule: missing-di-shape
 *
 * Warns when a process flow element (task, event, gateway, subprocess)
 * exists in the semantic model but has no corresponding BPMNShape in
 * the DI (diagram interchange) section.  Missing DI shapes mean the
 * element is invisible in the diagram and will not be rendered.
 *
 * This catches issues where layout operations or manual XML edits
 * accidentally drop DI entries for process elements.
 */

import { isType } from '../utils';

/** Types that are flow node elements and must have a DI shape. */
const FLOW_NODE_TYPES = [
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
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
  'bpmn:ComplexGateway',
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:BoundaryEvent',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:TextAnnotation',
];

function isFlowNode(node: any): boolean {
  return FLOW_NODE_TYPES.some((t) => isType(node, t));
}

/** Collect all BPMNShape bpmnElement IDs from the DI section. */
function collectDiShapeIds(definitions: any): Set<string> {
  const ids = new Set<string>();
  const diagrams = definitions?.diagrams;
  if (!diagrams) return ids;

  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNShape') && el.bpmnElement?.id) {
        ids.add(el.bpmnElement.id);
      }
    }
  }
  return ids;
}

/** Collect all BPMNEdge bpmnElement IDs from the DI section. */
function collectDiEdgeIds(definitions: any): Set<string> {
  const ids = new Set<string>();
  const diagrams = definitions?.diagrams;
  if (!diagrams) return ids;

  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNEdge') && el.bpmnElement?.id) {
        ids.add(el.bpmnElement.id);
      }
    }
  }
  return ids;
}

export default function missingDiShape() {
  function check(node: any, reporter: any) {
    // Only check at Process / SubProcess level to avoid duplicate reports
    if (!isType(node, 'bpmn:Process') && !isType(node, 'bpmn:SubProcess')) return;

    const flowElements = node.flowElements || [];
    if (flowElements.length === 0) return;

    const defs = findDefinitions(node);
    if (!defs) return;

    const shapeIds = collectDiShapeIds(defs);
    const edgeIds = collectDiEdgeIds(defs);

    for (const el of flowElements) {
      reportMissingShape(el, shapeIds, reporter);
      reportMissingEdge(el, edgeIds, reporter);
    }
  }

  return { check };
}

/** Walk up the parent chain to find bpmn:Definitions. */
function findDefinitions(node: any): any | null {
  let defs = node;
  while (defs && defs.$type !== 'bpmn:Definitions' && defs.$parent) {
    defs = defs.$parent;
  }
  if (!defs || defs.$type !== 'bpmn:Definitions') return null;
  if (!defs.diagrams || defs.diagrams.length === 0) return null;
  return defs;
}

/** Report a flow node missing its BPMNShape. */
function reportMissingShape(el: any, shapeIds: Set<string>, reporter: any): void {
  if (!isFlowNode(el)) return;
  if (shapeIds.has(el.id)) return;

  const label = el.name ? `"${el.name}"` : el.id;
  reporter.report(
    el.id,
    `Flow element ${label} (${el.$type}) has no BPMNShape in the diagram — ` +
      'it will be invisible. Run layout_bpmn_diagram to regenerate DI, ' +
      'or re-add the element with add_bpmn_element.'
  );
}

/** Report a sequence flow missing its BPMNEdge. */
function reportMissingEdge(el: any, edgeIds: Set<string>, reporter: any): void {
  if (!isType(el, 'bpmn:SequenceFlow')) return;
  if (edgeIds.has(el.id)) return;

  const sourceName = el.sourceRef?.name || el.sourceRef?.id || '?';
  const targetName = el.targetRef?.name || el.targetRef?.id || '?';
  reporter.report(
    el.id,
    `Sequence flow from "${sourceName}" to "${targetName}" has no BPMNEdge in the diagram — ` +
      'it will be invisible. Run layout_bpmn_diagram to regenerate DI, ' +
      'or recreate the connection with connect_bpmn_elements.'
  );
}
