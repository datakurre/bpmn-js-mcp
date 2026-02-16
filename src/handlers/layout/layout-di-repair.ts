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
  // Artifacts — excluded from ELK but need DI shapes
  'bpmn:TextAnnotation',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:Group',
]);

/** BPMN types that need BPMNShape with isHorizontal="true". */
const HORIZONTAL_SHAPE_TYPES = new Set(['bpmn:Participant', 'bpmn:Lane']);

/** BPMN connection types that need BPMNEdge entries. */
const EDGE_TYPES = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association']);

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
    // Check artifacts in subprocess scope
    if (el.artifacts) {
      checkArtifacts(el.artifacts, registeredIds, warnings);
    }
  }
}

/**
 * Check artifacts (TextAnnotation, Group, Association) for missing DI.
 */
function checkArtifacts(artifacts: any[], registeredIds: Set<string>, warnings: string[]): void {
  for (const el of artifacts) {
    if (
      (VISUAL_ELEMENT_TYPES.has(el.$type) || HORIZONTAL_SHAPE_TYPES.has(el.$type)) &&
      !registeredIds.has(el.id)
    ) {
      const label = el.name || el.text || el.id;
      warnings.push(
        `⚠️ DI integrity: ${label} (${el.$type}) exists in process but has no visual shape.`
      );
    }
  }
}

/** Extract collaborations from definitions root elements. */
function getCollaborations(definitions: any): any[] {
  return (definitions.rootElements || []).filter((el: any) => el.$type === 'bpmn:Collaboration');
}

/** Collect process IDs referenced by collaboration participants. */
function getParticipantProcessIds(collaborations: any[]): Set<string> {
  const ids = new Set<string>();
  for (const collab of collaborations) {
    for (const participant of collab.participants || []) {
      if (participant.processRef?.id) ids.add(participant.processRef.id);
    }
  }
  return ids;
}

/** Check collaboration participants, lanes, and message flows for missing DI. */
function checkCollaborationDi(
  collaborations: any[],
  registeredIds: Set<string>,
  warnings: string[]
): void {
  for (const collab of collaborations) {
    for (const participant of collab.participants || []) {
      if (!registeredIds.has(participant.id)) {
        warnings.push(
          `⚠️ DI integrity: "${participant.name || participant.id}" (bpmn:Participant) has no visual shape.`
        );
      }
      if (participant.processRef?.flowElements) {
        checkFlowElements(participant.processRef.flowElements, registeredIds, warnings);
      }
      if (participant.processRef?.artifacts) {
        checkArtifacts(participant.processRef.artifacts as any[], registeredIds, warnings);
      }
      checkLanesDi(participant.processRef, registeredIds, warnings);
    }
    checkMessageFlowsDi(collab.messageFlows, registeredIds, warnings);
  }
}

/** Check lanes within a process for missing DI. */
function checkLanesDi(processRef: any, registeredIds: Set<string>, warnings: string[]): void {
  for (const laneSet of (processRef?.laneSets || []) as any[]) {
    for (const lane of (laneSet.lanes || []) as any[]) {
      if (!registeredIds.has(lane.id)) {
        warnings.push(
          `⚠️ DI integrity: "${lane.name || lane.id}" (bpmn:Lane) has no visual shape.`
        );
      }
    }
  }
}

/** Check message flows for missing DI. */
function checkMessageFlowsDi(
  messageFlows: any[] | undefined,
  registeredIds: Set<string>,
  warnings: string[]
): void {
  for (const mf of (messageFlows || []) as any[]) {
    if (!registeredIds.has(mf.id)) {
      warnings.push(`⚠️ DI integrity: ${mf.id} (bpmn:MessageFlow) has no DI edge.`);
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
    for (const el of elementRegistry.getAll()) registeredIds.add(el.id);

    const collaborations = getCollaborations(definitions);
    const participantProcessIds = getParticipantProcessIds(collaborations);

    const processes = (definitions.rootElements || []).filter(
      (el: any) => el.$type === 'bpmn:Process' && !participantProcessIds.has(el.id)
    );
    for (const process of processes) {
      checkFlowElements(process.flowElements || [], registeredIds, warnings);
      checkArtifacts((process.artifacts || []) as any[], registeredIds, warnings);
    }

    checkCollaborationDi(collaborations, registeredIds, warnings);
  } catch {
    // Non-fatal: DI check failure should not break layout
  }

  return warnings;
}

// ── DI repair: missing element collectors ──────────────────────────────────

type MissingShape = { id: string; type: string; name?: string; isHorizontal?: boolean };
type MissingEdge = { id: string; sourceId?: string; targetId?: string };

/** Scan flow elements (tasks, gateways, events, flows) recursively. */
function scanFlowElements(
  flowElements: any[],
  registeredIds: Set<string>,
  shapes: MissingShape[],
  edges: MissingEdge[]
): void {
  for (const el of flowElements) {
    if (!registeredIds.has(el.id)) {
      if (EDGE_TYPES.has(el.$type)) {
        edges.push({ id: el.id, sourceId: el.sourceRef?.id, targetId: el.targetRef?.id });
      } else if (VISUAL_ELEMENT_TYPES.has(el.$type)) {
        shapes.push({ id: el.id, type: el.$type, name: el.name });
      }
    }
    if (el.flowElements) scanFlowElements(el.flowElements, registeredIds, shapes, edges);
    if (el.artifacts) scanArtifactElements(el.artifacts, registeredIds, shapes, edges);
  }
}

/** Scan artifact elements (TextAnnotation, Group, Association). */
function scanArtifactElements(
  artifacts: any[],
  registeredIds: Set<string>,
  shapes: MissingShape[],
  edges: MissingEdge[]
): void {
  for (const el of artifacts) {
    if (registeredIds.has(el.id)) continue;
    if (VISUAL_ELEMENT_TYPES.has(el.$type)) {
      shapes.push({ id: el.id, type: el.$type, name: el.name || el.text });
    } else if (EDGE_TYPES.has(el.$type)) {
      edges.push({ id: el.id, sourceId: el.sourceRef?.id, targetId: el.targetRef?.id });
    }
  }
}

/** Scan a single process (flowElements + artifacts). */
function scanProcess(
  proc: any,
  registeredIds: Set<string>,
  shapes: MissingShape[],
  edges: MissingEdge[]
): void {
  scanFlowElements(proc.flowElements || [], registeredIds, shapes, edges);
  scanArtifactElements((proc.artifacts || []) as any[], registeredIds, shapes, edges);
}

/** Collect missing DI for participant lanes. */
function collectMissingLanes(processRef: any, registeredIds: Set<string>): MissingShape[] {
  const missing: MissingShape[] = [];
  for (const laneSet of (processRef?.laneSets || []) as any[]) {
    for (const lane of (laneSet.lanes || []) as any[]) {
      if (!registeredIds.has(lane.id)) {
        missing.push({ id: lane.id, type: 'bpmn:Lane', name: lane.name, isHorizontal: true });
      }
    }
  }
  return missing;
}

/** Collect missing DI for collaboration elements (participants, lanes, message flows). */
function collectMissingCollabElements(
  collaborations: any[],
  registeredIds: Set<string>,
  shapes: MissingShape[],
  edges: MissingEdge[]
): void {
  for (const collab of collaborations) {
    for (const participant of collab.participants || []) {
      if (!registeredIds.has(participant.id)) {
        shapes.push({
          id: participant.id,
          type: 'bpmn:Participant',
          name: participant.name,
          isHorizontal: true,
        });
      }
      if (participant.processRef) {
        scanProcess(participant.processRef, registeredIds, shapes, edges);
        shapes.push(...collectMissingLanes(participant.processRef, registeredIds));
      }
    }
    for (const mf of (collab.messageFlows || []) as any[]) {
      if (!registeredIds.has(mf.id)) {
        edges.push({ id: mf.id, sourceId: mf.sourceRef?.id, targetId: mf.targetRef?.id });
      }
    }
    scanArtifactElements(collab.artifacts || [], registeredIds, shapes, edges);
  }
}

// ── DI repair: main collector ──────────────────────────────────────────────

/**
 * Collect flow elements missing from the element registry.
 * Returns separate arrays for shapes (flow nodes, artifacts, participants, lanes)
 * and edges (sequence flows, message flows, associations).
 */
function collectMissingDiElements(
  definitions: any,
  registeredIds: Set<string>
): { missingShapes: MissingShape[]; missingEdges: MissingEdge[] } {
  const missingShapes: MissingShape[] = [];
  const missingEdges: MissingEdge[] = [];

  const collaborations = getCollaborations(definitions);
  const participantProcessIds = getParticipantProcessIds(collaborations);

  // Standalone processes (not referenced by participants)
  const processes = (definitions.rootElements || []).filter(
    (el: any) => el.$type === 'bpmn:Process' && !participantProcessIds.has(el.id)
  );
  for (const proc of processes) {
    scanProcess(proc, registeredIds, missingShapes, missingEdges);
  }

  // Collaboration elements
  collectMissingCollabElements(collaborations, registeredIds, missingShapes, missingEdges);

  return { missingShapes, missingEdges };
}

/**
 * Build BPMNShape XML snippets for missing flow nodes, artifacts, participants, and lanes.
 * Places shapes at staggered positions so ELK layout can reposition them.
 * Participants and lanes get isHorizontal="true".
 */
function buildShapeXml(missing: MissingShape[]): string {
  const lines: string[] = [];
  let offsetX = 0;

  for (const el of missing) {
    const size = getElementSize(el.type);
    const isHoriz = el.isHorizontal ? ' isHorizontal="true"' : '';
    lines.push(
      `      <bpmndi:BPMNShape id="${el.id}_di" bpmnElement="${el.id}"${isHoriz}>`,
      `        <dc:Bounds x="${offsetX}" y="0" width="${size.width}" height="${size.height}" />`,
      `      </bpmndi:BPMNShape>`
    );
    offsetX += size.width + 50;
  }

  return lines.join('\n');
}

/**
 * Build BPMNEdge XML snippets for missing sequence flows, message flows, and associations.
 * Uses a simple 2-point waypoint at (0,0) → (100,0); layout will fix routing.
 */
function buildEdgeXml(missing: MissingEdge[]): string {
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
      // Also track businessObject IDs — they may differ from registry IDs
      // (e.g. after wrapProcessInCollaboration, participants can have
      // different IDs in the element registry vs the definitions model).
      if (el.businessObject?.id) registeredIds.add(el.businessObject.id);
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
