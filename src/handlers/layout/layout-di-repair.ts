/**
 * DI integrity checks and repair: detect and fix missing BPMNShape/BPMNEdge
 * entries so that ELK layout can position all elements.
 *
 * Extracted from layout-helpers.ts to keep it under the max-lines limit.
 */

import { getDefinitionsFromModeler } from '../../linter';
import { getElementSize } from '../../constants';
import { getService } from '../../bpmn-types';

// ── DI integrity check ────────────────────────────────────────────────────

/** BPMN types that must have a visual DI shape. */
const VISUAL_ELEMENT_TYPES = new Set([
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
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:BoundaryEvent',
]);

function checkFlowElements(
  flowElements: any[],
  registeredIds: Set<string>,
  warnings: string[]
): void {
  for (const el of flowElements) {
    if (VISUAL_ELEMENT_TYPES.has(el.$type) && !registeredIds.has(el.id)) {
      const label = el.name ? `"${el.name}"` : el.id;
      warnings.push(
        `⚠️ DI integrity: ${label} (${el.$type}) exists in process but has no visual shape. ` +
          'It may be invisible in the diagram. Re-add with add_bpmn_element or re-import the diagram.'
      );
    }
    // Recurse into subprocesses
    if (el.flowElements) {
      checkFlowElements(el.flowElements, registeredIds, warnings);
    }
  }
}

/**
 * Check DI integrity: compare process-level flow elements against the
 * element registry.  Returns warnings for elements that exist in the
 * semantic model but have no visual representation (no DI shape).
 */
export function checkDiIntegrity(diagram: any, elementRegistry: any): string[] {
  const warnings: string[] = [];

  try {
    const definitions = getDefinitionsFromModeler(diagram.modeler);
    if (!definitions) return warnings;

    const registeredIds = new Set<string>();
    for (const el of elementRegistry.getAll()) {
      registeredIds.add(el.id);
    }

    const processes = (definitions.rootElements || []).filter(
      (el: any) => el.$type === 'bpmn:Process'
    ) as any[];

    for (const process of processes) {
      checkFlowElements(process.flowElements || [], registeredIds, warnings);
    }

    // Also check participants' processes
    const collaborations = (definitions.rootElements || []).filter(
      (el: any) => el.$type === 'bpmn:Collaboration'
    ) as any[];
    for (const collab of collaborations) {
      for (const participant of collab.participants || []) {
        if (participant.processRef?.flowElements) {
          checkFlowElements(participant.processRef.flowElements, registeredIds, warnings);
        }
      }
    }
  } catch {
    // Non-fatal: DI check failure should not break layout
  }

  return warnings;
}

// ── DI repair: create missing BPMNShape/BPMNEdge entries ───────────────────

/** BPMN types that are sequence flows requiring BPMNEdge entries. */
const SEQUENCE_FLOW_TYPE = 'bpmn:SequenceFlow';

/**
 * Collect flow elements missing from the element registry.
 * Returns separate arrays for shapes (flow nodes) and edges (sequence flows).
 */
function collectMissingDiElements(
  definitions: any,
  registeredIds: Set<string>
): {
  missingShapes: Array<{ id: string; type: string; name?: string }>;
  missingEdges: Array<{ id: string; sourceId?: string; targetId?: string }>;
} {
  const missingShapes: Array<{ id: string; type: string; name?: string }> = [];
  const missingEdges: Array<{ id: string; sourceId?: string; targetId?: string }> = [];

  function scan(flowElements: any[]): void {
    for (const el of flowElements) {
      if (!registeredIds.has(el.id)) {
        if (el.$type === SEQUENCE_FLOW_TYPE) {
          missingEdges.push({
            id: el.id,
            sourceId: el.sourceRef?.id,
            targetId: el.targetRef?.id,
          });
        } else if (VISUAL_ELEMENT_TYPES.has(el.$type)) {
          missingShapes.push({ id: el.id, type: el.$type, name: el.name });
        }
      }
      // Recurse into subprocesses
      if (el.flowElements) scan(el.flowElements);
    }
  }

  const processes = (definitions.rootElements || []).filter(
    (el: any) => el.$type === 'bpmn:Process'
  );
  for (const proc of processes) {
    scan(proc.flowElements || []);
  }

  const collaborations = (definitions.rootElements || []).filter(
    (el: any) => el.$type === 'bpmn:Collaboration'
  );
  for (const collab of collaborations) {
    for (const participant of collab.participants || []) {
      if (participant.processRef?.flowElements) {
        scan(participant.processRef.flowElements);
      }
    }
  }

  return { missingShapes, missingEdges };
}

/**
 * Build BPMNShape XML snippets for missing flow nodes.
 * Places shapes at staggered positions so ELK layout can reposition them.
 */
function buildShapeXml(missing: Array<{ id: string; type: string }>): string {
  const lines: string[] = [];
  let offsetX = 0;

  for (const el of missing) {
    const size = getElementSize(el.type);
    lines.push(
      `      <bpmndi:BPMNShape id="${el.id}_di" bpmnElement="${el.id}">`,
      `        <dc:Bounds x="${offsetX}" y="0" width="${size.width}" height="${size.height}" />`,
      `      </bpmndi:BPMNShape>`
    );
    offsetX += size.width + 50;
  }

  return lines.join('\n');
}

/**
 * Build BPMNEdge XML snippets for missing sequence flows.
 * Uses a simple 2-point waypoint at (0,0) → (100,0); layout will fix routing.
 */
function buildEdgeXml(
  missing: Array<{ id: string; sourceId?: string; targetId?: string }>
): string {
  const lines: string[] = [];

  for (const flow of missing) {
    lines.push(
      `      <bpmndi:BPMNEdge id="${flow.id}_di" bpmnElement="${flow.id}">`,
      `        <di:waypoint x="0" y="0" />`,
      `        <di:waypoint x="100" y="0" />`,
      `      </bpmndi:BPMNEdge>`
    );
  }

  return lines.join('\n');
}

/**
 * Repair missing DI elements before layout.
 *
 * Detects flow nodes and sequence flows in the semantic model that have
 * no corresponding BPMNShape / BPMNEdge in the DI section, injects
 * default entries into the XML, and re-imports it into the modeler so
 * that ELK layout can position them properly.
 *
 * Returns human-readable descriptions of what was repaired, or an empty
 * array when nothing was missing.
 */
export async function repairMissingDiShapes(diagram: any): Promise<string[]> {
  try {
    const definitions = getDefinitionsFromModeler(diagram.modeler);
    if (!definitions) return [];

    const elementRegistry = getService(diagram.modeler, 'elementRegistry');
    const registeredIds = new Set<string>();
    for (const el of elementRegistry.getAll()) {
      registeredIds.add(el.id);
    }

    const { missingShapes, missingEdges } = collectMissingDiElements(definitions, registeredIds);

    if (missingShapes.length === 0 && missingEdges.length === 0) return [];

    // Export current XML
    const { xml } = await diagram.modeler.saveXML({ format: true });
    if (!xml) return [];

    // Build DI snippets to inject
    const shapeSnippet = missingShapes.length > 0 ? buildShapeXml(missingShapes) + '\n' : '';
    const edgeSnippet = missingEdges.length > 0 ? buildEdgeXml(missingEdges) + '\n' : '';
    const snippet = shapeSnippet + edgeSnippet;

    // Inject before closing </bpmndi:BPMNPlane>
    const marker = '</bpmndi:BPMNPlane>';
    if (!xml.includes(marker)) return [];

    const repairedXml = xml.replace(marker, snippet + '    ' + marker);

    // Re-import the repaired XML into the same modeler
    await diagram.modeler.importXML(repairedXml);
    diagram.xml = repairedXml;

    // Build repair log
    const repairs: string[] = [];
    for (const el of missingShapes) {
      const label = el.name ? `"${el.name}"` : el.id;
      repairs.push(`Repaired missing DI shape for ${label} (${el.type})`);
    }
    for (const flow of missingEdges) {
      repairs.push(
        `Repaired missing DI edge for ${flow.id}` +
          (flow.sourceId && flow.targetId ? ` (${flow.sourceId} → ${flow.targetId})` : '')
      );
    }
    return repairs;
  } catch {
    // Non-fatal: repair failure should not break layout
    return [];
  }
}
