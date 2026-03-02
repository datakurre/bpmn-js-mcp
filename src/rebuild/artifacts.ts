/**
 * Artifact positioning and label adjustment for the rebuild engine.
 *
 * Handles:
 * - Text annotations: positioned above-right of their associated element
 * - Data objects/stores: positioned below-right of their associated element
 * - Association / data-association layout after repositioning
 * - Flow labels: placed at first-segment midpoint, offset to the non-crossing side
 * - Element labels: placed at bpmn-js default positions (below element center)
 */

import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { DEFAULT_LABEL_SIZE, ELEMENT_LABEL_DISTANCE } from '../constants';

// ── Constants ──────────────────────────────────────────────────────────────

/** Element types treated as artifacts (excluded from main flow). */
const ARTIFACT_TYPES = new Set([
  'bpmn:TextAnnotation',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
]);

/**
 * Connection types used to link artifacts to flow nodes.
 * bpmn:Association links TextAnnotation ↔ flow node.
 * DataInput/OutputAssociation links DataObject/DataStore ↔ flow node.
 */
const ARTIFACT_CONNECTION_TYPES = new Set([
  'bpmn:Association',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
]);

// ── Artifact positioning ───────────────────────────────────────────────────

/**
 * Reposition artifacts (text annotations, data objects, data stores)
 * relative to their associated flow node.
 *
 * Text annotations are placed above-right of the source element,
 * matching bpmn-js `getTextAnnotationPosition()` from BpmnAutoPlaceUtil.
 *
 * Data objects/stores are placed below-right of the source element,
 * matching bpmn-js `getDataElementPosition()` from BpmnAutoPlaceUtil.
 *
 * After repositioning artifacts, associated connections (associations
 * and data associations) are re-laid out.
 *
 * @returns Number of artifacts repositioned.
 */
export function positionArtifacts(
  registry: ElementRegistry,
  modeling: Modeling,
  container: BpmnElement
): number {
  const allElements: BpmnElement[] = registry.getAll();
  const artifacts = allElements.filter(
    (el) => el.parent === container && ARTIFACT_TYPES.has(el.type)
  );

  if (artifacts.length === 0) return 0;

  let repositioned = 0;

  for (const artifact of artifacts) {
    const source = findAssociatedElement(artifact);
    if (!source) continue;

    const position = computeArtifactPosition(artifact, source);
    const currentCenterX = artifact.x + artifact.width / 2;
    const currentCenterY = artifact.y + artifact.height / 2;

    const dx = Math.round(position.x - currentCenterX);
    const dy = Math.round(position.y - currentCenterY);

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      modeling.moveElements([artifact], { x: dx, y: dy });
      repositioned++;
    }
  }

  // Layout artifact connections after repositioning
  layoutArtifactConnections(registry, modeling, container);

  return repositioned;
}

/**
 * Find the flow node associated with an artifact via connections.
 * Checks both incoming and outgoing connections, returning the first
 * non-artifact endpoint found.
 */
function findAssociatedElement(artifact: BpmnElement): BpmnElement | null {
  // Check outgoing connections (artifact → flow node)
  for (const conn of artifact.outgoing ?? []) {
    if (conn.target && !ARTIFACT_TYPES.has(conn.target.type)) {
      return conn.target;
    }
  }
  // Check incoming connections (flow node → artifact)
  for (const conn of artifact.incoming ?? []) {
    if (conn.source && !ARTIFACT_TYPES.has(conn.source.type)) {
      return conn.source;
    }
  }
  return null;
}

/**
 * Compute the target center position for an artifact relative to its
 * associated source element.
 *
 * Uses the same offsets as bpmn-js BpmnAutoPlaceUtil (horizontal mode):
 * - TextAnnotation: right edge + width/2, top - 50 - height/2
 * - DataObjectReference / DataStoreReference: right - 10 + width/2,
 *   bottom + 40 + height/2
 */
function computeArtifactPosition(
  artifact: BpmnElement,
  source: BpmnElement
): { x: number; y: number } {
  const sourceRight = source.x + source.width;

  if (artifact.type === 'bpmn:TextAnnotation') {
    return {
      x: sourceRight + artifact.width / 2,
      y: source.y - 50 - artifact.height / 2,
    };
  }

  // Data objects / data stores — below-right of source
  return {
    x: sourceRight - 10 + artifact.width / 2,
    y: source.y + source.height + 40 + artifact.height / 2,
  };
}

/**
 * Layout all artifact connections (associations + data associations)
 * within a container after artifacts have been repositioned.
 */
function layoutArtifactConnections(
  registry: ElementRegistry,
  modeling: Modeling,
  container: BpmnElement
): void {
  const allElements: BpmnElement[] = registry.getAll();

  for (const el of allElements) {
    if (el.parent !== container) continue;
    if (ARTIFACT_CONNECTION_TYPES.has(el.type)) {
      try {
        modeling.layoutConnection(el);
      } catch {
        // ManhattanLayout docking guard: skip connections with inconsistent waypoints.
      }
    }
  }
}

// ── Label adjustment ───────────────────────────────────────────────────────

/**
 * Adjust all labels in the diagram to bpmn-js default positions.
 * Synchronous — no syncXml needed (caller handles XML sync).
 *
 * 1. Centers flow labels on their connection's midpoint.
 * 2. Adjusts element labels (events, gateways, data objects) to
 *    default positions below their element center.
 *
 * @returns Number of labels moved.
 */
export function adjustLabels(registry: ElementRegistry, modeling: Modeling): number {
  let count = 0;
  count += centerFlowLabels(registry, modeling);
  count += adjustElementLabels(registry, modeling);
  return count;
}

// ── Flow label centering ───────────────────────────────────────────────────

/** Gap (px) between connection segment and the nearest edge of the label box. */
const FLOW_LABEL_SIDE_OFFSET = 5;

/**
 * Position labeled flow labels at the midpoint of their first segment,
 * offset perpendicular to the side with fewer shape overlaps.
 *
 * - Horizontal first segment → above (preferred) or below.
 * - Vertical first segment   → right (preferred) or left.
 *
 * This matches bpmn-js interactive placement: the label hugs the first
 * bend of the connection rather than floating at the path midpoint.
 */
function centerFlowLabels(registry: ElementRegistry, modeling: Modeling): number {
  const allElements: BpmnElement[] = registry.getAll();

  // Non-container, non-flow shapes used when scoring candidate sides.
  const shapes = allElements.filter(
    (el) =>
      el.type !== 'label' &&
      !el.type.includes('Flow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.x !== undefined &&
      el.width !== undefined
  );

  let count = 0;

  for (const flow of allElements) {
    if (flow.type !== 'bpmn:SequenceFlow' && flow.type !== 'bpmn:MessageFlow') continue;
    if (!flow.label || !flow.businessObject?.name) continue;
    if (!flow.waypoints || flow.waypoints.length < 2) continue;

    const labelW = flow.label.width || DEFAULT_LABEL_SIZE.width;
    const labelH = flow.label.height || DEFAULT_LABEL_SIZE.height;

    const target = flowLabelPos(flow.waypoints, labelW, labelH, shapes);

    const dx = target.x - flow.label.x;
    const dy = target.y - flow.label.y;

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      modeling.moveShape(flow.label as unknown as BpmnElement, { x: dx, y: dy });
      count++;
    }
  }

  return count;
}

/**
 * Compute the bpmn-js-style label position for a flow connection.
 *
 * Takes the midpoint of the first segment (waypoints[0] → waypoints[1]),
 * then places the label on the perpendicular side with fewer shape overlaps.
 */
function flowLabelPos(
  waypoints: Array<{ x: number; y: number }>,
  labelW: number,
  labelH: number,
  shapes: BpmnElement[]
): { x: number; y: number } {
  const p0 = waypoints[0];
  const p1 = waypoints[1];

  const midX = (p0.x + p1.x) / 2;
  const midY = (p0.y + p1.y) / 2;
  const isHoriz = Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y);

  // Two perpendicular candidates — candidateA is the preferred default side.
  const candidateA = isHoriz
    ? { x: Math.round(midX - labelW / 2), y: Math.round(midY - FLOW_LABEL_SIDE_OFFSET - labelH) } // above
    : { x: Math.round(midX + FLOW_LABEL_SIDE_OFFSET), y: Math.round(midY - labelH / 2) }; // right
  const candidateB = isHoriz
    ? { x: Math.round(midX - labelW / 2), y: Math.round(midY + FLOW_LABEL_SIDE_OFFSET) } // below
    : { x: Math.round(midX - FLOW_LABEL_SIDE_OFFSET - labelW), y: Math.round(midY - labelH / 2) }; // left

  return labelSideScore(candidateA, labelW, labelH, shapes) <=
    labelSideScore(candidateB, labelW, labelH, shapes)
    ? candidateA
    : candidateB;
}

/** Count shape overlaps for a label candidate rect (lower score = better). */
function labelSideScore(
  pos: { x: number; y: number },
  w: number,
  h: number,
  shapes: BpmnElement[]
): number {
  const x2 = pos.x + w;
  const y2 = pos.y + h;
  let score = 0;
  for (const s of shapes) {
    if (s.x === undefined || s.y === undefined || s.width === undefined || s.height === undefined) {
      continue;
    }
    if (pos.x < s.x + s.width && x2 > s.x && pos.y < s.y + s.height && y2 > s.y) score++;
  }
  return score;
}

// ── Element label adjustment ───────────────────────────────────────────────

/** Element types that have external labels in BPMN. */
function hasExternalLabel(type: string): boolean {
  return (
    type.includes('Event') ||
    type.includes('Gateway') ||
    type === 'bpmn:DataStoreReference' ||
    type === 'bpmn:DataObjectReference'
  );
}

/**
 * Adjust external labels (events, gateways, data objects) to the bpmn-js
 * default position: centered below the element.
 *
 * Replicates `getExternalLabelMid()` from bpmn-js LabelUtil.
 */
function adjustElementLabels(registry: ElementRegistry, modeling: Modeling): number {
  const allElements: BpmnElement[] = registry.getAll();
  let count = 0;

  for (const el of allElements) {
    if (!hasExternalLabel(el.type)) continue;
    if (!el.label || !el.businessObject?.name) continue;

    const label = el.label;
    const labelW = label.width || DEFAULT_LABEL_SIZE.width;
    const labelH = label.height || DEFAULT_LABEL_SIZE.height;

    // bpmn-js default: centre below element
    const midX = el.x + el.width / 2;
    const midY = el.y + el.height + ELEMENT_LABEL_DISTANCE + labelH / 2;

    const targetX = Math.round(midX - labelW / 2);
    const targetY = Math.round(midY - labelH / 2);

    const dx = targetX - label.x;
    const dy = targetY - label.y;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      modeling.moveShape(label as BpmnElement, { x: dx, y: dy });
      count++;
    }
  }

  return count;
}
