/**
 * DI integrity checks and repair: detect and fix missing BPMNShape/BPMNEdge
 * entries so that the layout engine can position all elements.
 *
 * Uses the bpmn-js modeler API (bpmnImporter.add) to create proper DI entries
 * directly, avoiding fragile XML string manipulation and re-import.
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
  // Artifacts — not part of flow but need DI shapes
  'bpmn:TextAnnotation',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:Group',
]);

/** BPMN connection types that need BPMNEdge entries. */
const EDGE_TYPES = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association']);

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

/**
 * Check DI integrity: compare process-level flow elements against the
 * element registry.  Returns warnings for elements that exist in the
 * semantic model but have no visual representation (no DI shape).
 *
 * Delegates to `collectMissingDiElements` to avoid duplicating traversal logic.
 */
export function checkDiIntegrity(diagram: any, elementRegistry: any): string[] {
  try {
    const definitions = getDefinitionsFromModeler(diagram.modeler);
    if (!definitions) return [];

    // Mirror repairDiIntegrity: include both the shape ID and the business-object
    // ID so that elements repaired via bpmnImporter (whose el.id may differ from
    // el.businessObject.id) are not reported as still-missing.
    const registeredIds = new Set<string>();
    for (const el of elementRegistry.getAll()) {
      registeredIds.add(el.id);
      if (el.businessObject?.id) registeredIds.add(el.businessObject.id);
    }

    const { missingShapes, missingEdges } = collectMissingDiElements(definitions, registeredIds);
    const warnings: string[] = [];

    for (const el of missingShapes) {
      const label = el.name ? `"${el.name}"` : el.id;
      warnings.push(
        `⚠️ DI integrity: ${label} (${el.type}) exists in process but has no visual shape. ` +
          'It may be invisible in the diagram. Re-add with add_bpmn_elements or re-import the diagram.'
      );
    }
    for (const edge of missingEdges) {
      warnings.push(`⚠️ DI integrity: ${edge.id} has no DI edge.`);
    }

    return warnings;
  } catch {
    return [];
  }
}

// ── DI repair: missing element collectors ──────────────────────────────────

type MissingShape = {
  id: string;
  businessObject: any;
  type: string;
  name?: string;
  isHorizontal?: boolean;
};
type MissingEdge = { id: string; businessObject: any; sourceId?: string; targetId?: string };

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
        edges.push({
          id: el.id,
          businessObject: el,
          sourceId: el.sourceRef?.id,
          targetId: el.targetRef?.id,
        });
      } else if (VISUAL_ELEMENT_TYPES.has(el.$type)) {
        shapes.push({ id: el.id, businessObject: el, type: el.$type, name: el.name });
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
      shapes.push({ id: el.id, businessObject: el, type: el.$type, name: el.name || el.text });
    } else if (EDGE_TYPES.has(el.$type)) {
      edges.push({
        id: el.id,
        businessObject: el,
        sourceId: el.sourceRef?.id,
        targetId: el.targetRef?.id,
      });
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
        missing.push({
          id: lane.id,
          businessObject: lane,
          type: 'bpmn:Lane',
          name: lane.name,
          isHorizontal: true,
        });
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
          businessObject: participant,
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
        edges.push({
          id: mf.id,
          businessObject: mf,
          sourceId: mf.sourceRef?.id,
          targetId: mf.targetRef?.id,
        });
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

// ── DI repair: shape ordering ──────────────────────────────────────────────

/** Priority for shape creation order: containers first, boundary events last. */
function shapeCreationOrder(type: string): number {
  if (type === 'bpmn:Participant') return 0;
  if (type === 'bpmn:Lane') return 1;
  if (type === 'bpmn:BoundaryEvent') return 3;
  return 2;
}

// ── DI repair: parent resolution ───────────────────────────────────────────

/**
 * Resolve the parent canvas element for a semantic business object.
 *
 * Walks the `$parent` chain to find the nearest element registered in the
 * element registry.  Handles Process → Participant resolution for
 * collaboration diagrams.
 */
function resolveParentElement(elementRegistry: any, canvas: any, semantic: any): any {
  let parentBo = semantic.$parent;

  while (parentBo) {
    // Direct registry lookup (subprocess, participant, etc.)
    const parentEl = elementRegistry.get(parentBo.id);
    if (parentEl) return parentEl;

    // Process → Participant resolution for collaborations
    if (parentBo.$type === 'bpmn:Process') {
      for (const el of elementRegistry.getAll()) {
        if (
          el.type === 'bpmn:Participant' &&
          (el.businessObject?.processRef === parentBo ||
            el.businessObject?.processRef?.id === parentBo.id)
        ) {
          return el;
        }
      }
    }

    parentBo = parentBo.$parent;
  }

  return canvas.getRootElement();
}

// ── DI repair: main function ───────────────────────────────────────────────

/** Services needed for DI repair. */
interface RepairContext {
  moddle: any;
  canvas: any;
  elementRegistry: any;
  bpmnImporter: any;
  plane: any;
}

/** Create BPMNShape DI entries for missing shapes and register them with the canvas. */
function addMissingShapes(ctx: RepairContext, missingShapes: MissingShape[]): void {
  let offsetX = 0;
  for (const el of missingShapes) {
    const size = getElementSize(el.type);
    const bounds = ctx.moddle.create('dc:Bounds', {
      x: offsetX,
      y: 0,
      width: size.width,
      height: size.height,
    });
    const diAttrs: Record<string, any> = {
      id: `${el.id}_di`,
      bpmnElement: el.businessObject,
      bounds,
    };
    if (el.isHorizontal) diAttrs.isHorizontal = true;

    const diShape = ctx.moddle.create('bpmndi:BPMNShape', diAttrs);
    diShape.$parent = ctx.plane;
    bounds.$parent = diShape;
    ctx.plane.planeElement.push(diShape);

    const parent = resolveParentElement(ctx.elementRegistry, ctx.canvas, el.businessObject);
    ctx.bpmnImporter.add(el.businessObject, diShape, parent);
    offsetX += size.width + 50;
  }
}

/** Create BPMNEdge DI entries for missing edges and register them with the canvas. */
function addMissingEdges(ctx: RepairContext, missingEdges: MissingEdge[]): void {
  for (const edge of missingEdges) {
    const waypoints = [
      ctx.moddle.create('dc:Point', { x: 0, y: 0 }),
      ctx.moddle.create('dc:Point', { x: 100, y: 0 }),
    ];
    const diEdge = ctx.moddle.create('bpmndi:BPMNEdge', {
      id: `${edge.id}_di`,
      bpmnElement: edge.businessObject,
      waypoint: waypoints,
    });
    diEdge.$parent = ctx.plane;
    for (const wp of waypoints) wp.$parent = diEdge;
    ctx.plane.planeElement.push(diEdge);

    const parent = resolveParentElement(ctx.elementRegistry, ctx.canvas, edge.businessObject);
    ctx.bpmnImporter.add(edge.businessObject, diEdge, parent);
  }
}

/** Build human-readable repair log. */
function buildRepairLog(shapes: MissingShape[], edges: MissingEdge[]): string[] {
  const repairs: string[] = [];
  for (const el of shapes) {
    const label = el.name ? `"${el.name}"` : el.id;
    repairs.push(`Repaired missing DI shape for ${label} (${el.type})`);
  }
  for (const flow of edges) {
    repairs.push(
      `Repaired missing DI edge for ${flow.id}` +
        (flow.sourceId && flow.targetId ? ` (${flow.sourceId} → ${flow.targetId})` : '')
    );
  }
  return repairs;
}

/**
 * Repair missing DI elements before layout.
 *
 * Detects flow nodes and sequence flows in the semantic model that have
 * no corresponding BPMNShape / BPMNEdge in the DI section, creates
 * proper DI entries via the moddle API, and registers them with the
 * canvas via bpmnImporter.add().
 *
 * This avoids XML string manipulation and re-import — all changes go
 * through the bpmn-js modeler API.
 *
 * Returns human-readable descriptions of what was repaired, or an empty
 * array when nothing was missing.
 */
export function repairMissingDiShapes(diagram: any): string[] {
  try {
    const definitions = getDefinitionsFromModeler(diagram.modeler);
    if (!definitions) return [];

    const elementRegistry = getService(diagram.modeler, 'elementRegistry');
    const registeredIds = new Set<string>();
    for (const el of elementRegistry.getAll()) {
      registeredIds.add(el.id);
      if (el.businessObject?.id) registeredIds.add(el.businessObject.id);
    }

    const { missingShapes, missingEdges } = collectMissingDiElements(definitions, registeredIds);
    if (missingShapes.length === 0 && missingEdges.length === 0) return [];

    const plane: any = definitions.diagrams?.[0]?.plane;
    if (!plane) return [];
    if (!plane.planeElement) plane.planeElement = [];

    const ctx: RepairContext = {
      moddle: getService(diagram.modeler, 'moddle'),
      canvas: getService(diagram.modeler, 'canvas'),
      elementRegistry,
      bpmnImporter: diagram.modeler.get('bpmnImporter'),
      plane,
    };

    // Sort shapes: containers first, boundary events last
    missingShapes.sort((a, b) => shapeCreationOrder(a.type) - shapeCreationOrder(b.type));

    addMissingShapes(ctx, missingShapes);
    addMissingEdges(ctx, missingEdges);

    return buildRepairLog(missingShapes, missingEdges);
  } catch {
    // Non-fatal: repair failure should not break layout
    return [];
  }
}
