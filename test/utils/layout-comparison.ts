/**
 * Utilities for comparing element positions between reference and generated BPMN/SVG.
 * Used by layout regression and visual comparison tests.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REFERENCES_DIR = resolve(__dirname, '..', 'fixtures', 'layout-references');

// ── Reference BPMN position extraction ─────────────────────────────────────

/** Shape position info extracted from a reference BPMN. */
export interface RefPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Parse a reference BPMN XML and extract a Map<elementId, RefPosition>
 * for all BPMNShape entries in the diagram.
 */
export function loadReferencePositions(name: string): Map<string, RefPosition> {
  const filePath = resolve(REFERENCES_DIR, `${name}.bpmn`);
  const xml = readFileSync(filePath, 'utf-8');
  return extractBpmnPositions(xml);
}

/** A single position delta for reporting. */
export interface PositionDelta {
  elementId: string;
  refX: number;
  refY: number;
  actualX: number;
  actualY: number;
  dx: number;
  dy: number;
}

/**
 * Compare element positions in a registry against a reference BPMN.
 * Returns an array of deltas for all matched elements.
 * Elements beyond `tolerance` are considered mismatched.
 */
export function comparePositions(
  registry: any,
  referenceName: string,
  tolerance = 5
): { deltas: PositionDelta[]; mismatches: PositionDelta[]; matchRate: number } {
  const refPositions = loadReferencePositions(referenceName);
  const deltas: PositionDelta[] = [];
  const mismatches: PositionDelta[] = [];

  for (const [elementId, ref] of refPositions) {
    const el = registry.get(elementId);
    if (!el || el.type === 'label') continue;

    const dx = el.x - ref.x;
    const dy = el.y - ref.y;
    const delta: PositionDelta = {
      elementId,
      refX: ref.x,
      refY: ref.y,
      actualX: el.x,
      actualY: el.y,
      dx,
      dy,
    };
    deltas.push(delta);
    if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance) {
      mismatches.push(delta);
    }
  }

  const matchRate = deltas.length > 0 ? (deltas.length - mismatches.length) / deltas.length : 0;
  return { deltas, mismatches, matchRate };
}

// ── Origin-normalised comparison ───────────────────────────────────────────

/** A normalised position delta for reporting. */
export interface NormalisedDelta {
  elementId: string;
  refX: number;
  refY: number;
  genX: number;
  genY: number;
  /** Delta after subtracting median offset */
  dx: number;
  dy: number;
}

/**
 * Compare two position maps (reference and generated), normalising away
 * uniform origin offsets.
 *
 * Computes the median Δx and Δy across all shared elements, then subtracts
 * that offset from the generated positions. This isolates real layout
 * differences from uniform translation.
 *
 * @param refPositions  Position map from reference SVG/BPMN
 * @param genPositions  Position map from generated SVG/BPMN
 * @param tolerance     Max acceptable delta (px) per axis — default 20
 * @returns Normalised deltas, mismatches, and origin offset
 */
export function compareWithNormalisation(
  refPositions: Map<string, { x: number; y: number }>,
  genPositions: Map<string, { x: number; y: number }>,
  tolerance = 20
): {
  originOffset: { dx: number; dy: number };
  deltas: NormalisedDelta[];
  mismatches: NormalisedDelta[];
  matchRate: number;
} {
  // Find shared element IDs
  const sharedIds: string[] = [];
  for (const id of refPositions.keys()) {
    if (genPositions.has(id)) {
      sharedIds.push(id);
    }
  }

  if (sharedIds.length === 0) {
    return { originOffset: { dx: 0, dy: 0 }, deltas: [], mismatches: [], matchRate: 0 };
  }

  // Compute raw deltas for all shared elements
  const rawDxs: number[] = [];
  const rawDys: number[] = [];
  for (const id of sharedIds) {
    const ref = refPositions.get(id)!;
    const gen = genPositions.get(id)!;
    rawDxs.push(gen.x - ref.x);
    rawDys.push(gen.y - ref.y);
  }

  // Compute median offset (robust to outliers)
  const medianDx = median(rawDxs);
  const medianDy = median(rawDys);

  // Compute normalised deltas
  const deltas: NormalisedDelta[] = [];
  const mismatches: NormalisedDelta[] = [];

  for (const id of sharedIds) {
    const ref = refPositions.get(id)!;
    const gen = genPositions.get(id)!;
    const dx = gen.x - ref.x - medianDx;
    const dy = gen.y - ref.y - medianDy;
    const delta: NormalisedDelta = {
      elementId: id,
      refX: ref.x,
      refY: ref.y,
      genX: gen.x,
      genY: gen.y,
      dx,
      dy,
    };
    deltas.push(delta);
    if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance) {
      mismatches.push(delta);
    }
  }

  const matchRate = deltas.length > 0 ? (deltas.length - mismatches.length) / deltas.length : 0;

  return {
    originOffset: { dx: medianDx, dy: medianDy },
    deltas,
    mismatches,
    matchRate,
  };
}

/** Compute the median of a numeric array. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ── SVG position parsing ───────────────────────────────────────────────────

/** Position info extracted from an SVG file. */
export interface SvgPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Parse element positions from an SVG file using `data-element-id` and
 * `transform` attributes. Returns a map of `{ elementId → SvgPosition }`.
 *
 * Handles both `transform="matrix(1 0 0 1 x y)"` (reference SVGs from
 * Camunda Modeler) and `transform="translate(x, y)"` (generated SVGs
 * from bpmn-js headless).
 *
 * Skips label elements (IDs ending in `_label`), connections
 * (SequenceFlow/MessageFlow), and the root process/collaboration.
 */
export function parsePositionsFromSVG(svgContent: string): Map<string, SvgPosition> {
  const positions = new Map<string, SvgPosition>();

  // Match shape groups with data-element-id and transform
  const shapeRegex =
    /data-element-id="([^"]+)"[^>]*?transform="(?:matrix\(\s*1\s+0\s+0\s+1\s+([\d.e+-]+)\s+([\d.e+-]+)\s*\)|translate\(\s*([\d.e+-]+)\s*,?\s*([\d.e+-]+)\s*\))"/g;

  let match;
  while ((match = shapeRegex.exec(svgContent)) !== null) {
    const elementId = match[1];

    // Skip labels, connections, and infrastructure elements
    if (
      elementId.endsWith('_label') ||
      elementId.startsWith('Flow_') ||
      elementId.startsWith('MessageFlow_') ||
      elementId.startsWith('DataInputAssociation_') ||
      elementId.startsWith('DataOutputAssociation_') ||
      elementId === 'Process_1' ||
      elementId === 'Collaboration_1'
    ) {
      continue;
    }

    const x = parseFloat(match[2] ?? match[4]);
    const y = parseFloat(match[3] ?? match[5]);

    if (isNaN(x) || isNaN(y)) continue;

    // Extract width/height from the first rect or circle inside this group
    // For now, use a heuristic: find the next djs-hit rect dimensions
    // after this element in the SVG (within the same group)
    // This is approximate — we don't need sub-pixel accuracy for comparison.
    // Use standard BPMN sizes as fallbacks.
    let width = 100;
    let height = 80;

    if (elementId.startsWith('Event_')) {
      width = 36;
      height = 36;
    } else if (elementId.startsWith('Gateway_')) {
      width = 50;
      height = 50;
    } else if (elementId.startsWith('Participant_')) {
      // Try to extract participant dimensions from the SVG
      const afterMatch = svgContent.slice(Math.max(0, match.index));
      const rectMatch = afterMatch.match(
        /class="djs-hit[^"]*"[^>]*width="(\d+)"[^>]*height="(\d+)"/
      );
      if (rectMatch) {
        width = parseInt(rectMatch[1], 10);
        height = parseInt(rectMatch[2], 10);
      }
    }

    positions.set(elementId, { x, y, width, height });
  }

  return positions;
}

/**
 * Load and parse positions from an SVG file.
 */
export function loadPositionsFromSVG(filePath: string): Map<string, SvgPosition> {
  const svg = readFileSync(filePath, 'utf-8');
  return parsePositionsFromSVG(svg);
}

// ── BPMN XML comparison utilities ──────────────────────────────────────────

/**
 * Normalise a BPMN XML string for structural comparison.
 *
 * Strips volatile attributes that change between runs (random ID parts,
 * `_di` suffixes, exact coordinate values in diagram interchange) and
 * normalises whitespace so that semantically identical BPMN produces
 * identical normalised output.
 *
 * Coordinates are NOT stripped — they are key for layout comparison.
 * Only random ID middle segments (e.g. `UserTask_a1b2c3d_DoWork` →
 * `UserTask_*_DoWork`) are normalised to tolerate ID randomness.
 */
export function normaliseBpmnXml(xml: string): string {
  return (
    xml
      // Normalise 3-part IDs with random middle: Type_randomPart_Name → Type_*_Name
      // These match the pattern from ADR-013: 7-char alphanumeric middle segment
      .replace(
        /(\b(?:Flow|UserTask|ServiceTask|ScriptTask|ManualTask|BusinessRuleTask|SendTask|ReceiveTask|CallActivity|ExclusiveGateway|ParallelGateway|InclusiveGateway|EventBasedGateway|StartEvent|EndEvent|IntermediateCatchEvent|IntermediateThrowEvent|BoundaryEvent|SubProcess|Gateway|Activity|Event|Participant|Lane|DataObjectReference|DataStoreReference|TextAnnotation|Group|ErrorEventDefinition)_)[a-z0-9]{7}_/gi,
        '$1*_'
      )
      // Normalise standalone random IDs (unnamed elements): Type_randomPart (no second _Name)
      // Only match if NOT followed by underscore+word (to avoid clobbering named IDs)
      .replace(/(\b(?:Flow|Gateway|Activity|Event)_)[a-z0-9]{5,8}\b(?!_\w)/gi, '$1*')
      // Normalise the DI shape/edge id suffixes which may have random parts
      .replace(/(id=")[^"]*_di"/g, '$1*_di"')
      // Strip the exporter/exporterVersion attributes (differ between tools)
      .replace(/\s+exporter="[^"]*"/g, '')
      .replace(/\s+exporterVersion="[^"]*"/g, '')
      // Normalise whitespace: collapse multiple spaces/newlines
      .replace(/\r\n/g, '\n')
  );
}

/**
 * Extract the process-level BPMN XML (everything inside `<bpmn:process>`)
 * without diagram interchange (DI) elements. Useful for comparing the
 * semantic process structure independently of layout coordinates.
 */
export function extractProcessXml(xml: string): string {
  const processMatch = xml.match(/<bpmn:process[\s\S]*?<\/bpmn:process>/);
  return processMatch ? processMatch[0] : '';
}

/**
 * Extract diagram interchange (DI) positions from BPMN XML.
 * Returns the same format as loadReferencePositions but from any XML string.
 */
export function extractBpmnPositions(xml: string): Map<string, RefPosition> {
  const positions = new Map<string, RefPosition>();
  const shapeRegex =
    /<bpmndi:BPMNShape[^>]*id="([^"]*)"[^>]*bpmnElement="([^"]*)"[^>]*>([\s\S]*?)<\/bpmndi:BPMNShape>/g;
  const boundsRegex =
    /<dc:Bounds\s+x="([^"]*?)"\s+y="([^"]*?)"\s+width="([^"]*?)"\s+height="([^"]*?)"/;

  let match;
  while ((match = shapeRegex.exec(xml)) !== null) {
    const bpmnElement = match[2];
    const inner = match[3];
    const boundsMatch = boundsRegex.exec(inner);
    if (boundsMatch) {
      positions.set(bpmnElement, {
        x: parseFloat(boundsMatch[1]),
        y: parseFloat(boundsMatch[2]),
        width: parseFloat(boundsMatch[3]),
        height: parseFloat(boundsMatch[4]),
      });
    }
  }
  return positions;
}

/**
 * Compare BPMN DI positions from two XML strings using origin normalisation.
 * Wraps `compareWithNormalisation` for BPMN-to-BPMN comparison.
 */
export function compareBpmnPositions(referenceXml: string, generatedXml: string, tolerance = 20) {
  const refPositions = extractBpmnPositions(referenceXml);
  const genPositions = extractBpmnPositions(generatedXml);
  return compareWithNormalisation(refPositions, genPositions, tolerance);
}

/**
 * Load a reference BPMN file as raw XML string.
 */
export function loadReferenceBpmn(name: string): string {
  const filePath = resolve(REFERENCES_DIR, `${name}.bpmn`);
  return readFileSync(filePath, 'utf-8');
}

// ── Edge waypoint comparison (I7-1) ────────────────────────────────────────

/** Waypoints for a single BPMN edge. */
export interface EdgeWaypoints {
  edgeId: string;
  bpmnElement: string;
  waypoints: Array<{ x: number; y: number }>;
}

/**
 * Extract edge waypoints from BPMN XML (I7-1).
 *
 * Parses all `<bpmndi:BPMNEdge>` elements and their `<di:waypoint>` children.
 * Returns a map keyed by the `bpmnElement` attribute (the flow ID) so that
 * reference and generated XML can be compared by semantic element ID.
 */
export function extractEdgeWaypoints(xml: string): Map<string, EdgeWaypoints> {
  const edges = new Map<string, EdgeWaypoints>();
  const edgeRegex =
    /<bpmndi:BPMNEdge[^>]*id="([^"]*)"[^>]*bpmnElement="([^"]*)"[^>]*>([\s\S]*?)<\/bpmndi:BPMNEdge>/g;
  const waypointRegex = /<di:waypoint\s+x="([^"]*?)"\s+y="([^"]*?)"/g;

  let edgeMatch;
  while ((edgeMatch = edgeRegex.exec(xml)) !== null) {
    const edgeId = edgeMatch[1];
    const bpmnElement = edgeMatch[2];
    const inner = edgeMatch[3];
    const waypoints: Array<{ x: number; y: number }> = [];

    waypointRegex.lastIndex = 0;
    let wpMatch;
    while ((wpMatch = waypointRegex.exec(inner)) !== null) {
      waypoints.push({ x: parseFloat(wpMatch[1]), y: parseFloat(wpMatch[2]) });
    }

    if (waypoints.length >= 2) {
      edges.set(bpmnElement, { edgeId, bpmnElement, waypoints });
    }
  }
  return edges;
}

/** Result of comparing edge waypoints between reference and generated BPMN. */
export interface EdgeWaypointComparison {
  totalEdges: number;
  matchedEdges: number;
  matchRate: number;
  mismatches: Array<{ edgeId: string; issue: string }>;
}

/**
 * Compare two sets of waypoints for a single edge.
 * Returns undefined if they match within tolerance, or an issue description.
 */
function compareWaypointSets(
  ref: EdgeWaypoints,
  gen: EdgeWaypoints,
  tolerance: number
): string | undefined {
  if (ref.waypoints.length !== gen.waypoints.length) {
    // Count mismatch — compare just endpoints to check connectivity
    const refFirst = ref.waypoints[0];
    const refLast = ref.waypoints[ref.waypoints.length - 1];
    const genFirst = gen.waypoints[0];
    const genLast = gen.waypoints[gen.waypoints.length - 1];
    const endpointDelta = Math.max(
      Math.abs(refFirst.x - genFirst.x),
      Math.abs(refFirst.y - genFirst.y),
      Math.abs(refLast.x - genLast.x),
      Math.abs(refLast.y - genLast.y)
    );
    if (endpointDelta > tolerance) {
      return `Waypoint count mismatch: ref=${ref.waypoints.length} gen=${gen.waypoints.length}; endpoint delta=${endpointDelta.toFixed(0)}px`;
    }
    return undefined;
  }

  for (let i = 0; i < ref.waypoints.length; i++) {
    const dx = Math.abs(ref.waypoints[i].x - gen.waypoints[i].x);
    const dy = Math.abs(ref.waypoints[i].y - gen.waypoints[i].y);
    if (dx > tolerance || dy > tolerance) {
      return `wp[${i}]: ref=(${ref.waypoints[i].x},${ref.waypoints[i].y}) gen=(${gen.waypoints[i].x},${gen.waypoints[i].y}) Δ=(${dx.toFixed(0)},${dy.toFixed(0)})`;
    }
  }
  return undefined;
}

/**
 * Compare edge waypoints between reference and generated BPMN XML (I7-1).
 *
 * Checks waypoint counts and endpoint positions for each shared BPMNEdge.
 * When counts differ, falls back to comparing just the first and last
 * waypoints (start/end of the route) within `tolerance` pixels.
 */
export function compareEdgeWaypoints(
  referenceXml: string,
  generatedXml: string,
  tolerance = 20
): EdgeWaypointComparison {
  const refEdges = extractEdgeWaypoints(referenceXml);
  const genEdges = extractEdgeWaypoints(generatedXml);

  const mismatches: Array<{ edgeId: string; issue: string }> = [];
  let totalEdges = 0;
  let matchedEdges = 0;

  for (const [elementId, refEdge] of refEdges) {
    const genEdge = genEdges.get(elementId);
    if (!genEdge) continue;
    totalEdges++;

    const issue = compareWaypointSets(refEdge, genEdge, tolerance);
    if (issue) {
      mismatches.push({ edgeId: elementId, issue });
    } else {
      matchedEdges++;
    }
  }

  const matchRate = totalEdges > 0 ? matchedEdges / totalEdges : 0;
  return { totalEdges, matchedEdges, matchRate, mismatches };
}

// ── Per-type match rates (I7-5) ────────────────────────────────────────────

/** Prefix-to-type mapping for BPMN element classification. */
const ELEMENT_TYPE_PREFIXES: ReadonlyArray<[string, string]> = [
  ['StartEvent_', 'events'],
  ['EndEvent_', 'events'],
  ['IntermediateCatchEvent_', 'events'],
  ['IntermediateThrowEvent_', 'events'],
  ['BoundaryEvent_', 'events'],
  ['Gateway_', 'gateways'],
  ['ExclusiveGateway_', 'gateways'],
  ['ParallelGateway_', 'gateways'],
  ['InclusiveGateway_', 'gateways'],
  ['EventBasedGateway_', 'gateways'],
  ['UserTask_', 'tasks'],
  ['ServiceTask_', 'tasks'],
  ['ScriptTask_', 'tasks'],
  ['Task_', 'tasks'],
  ['ManualTask_', 'tasks'],
  ['BusinessRuleTask_', 'tasks'],
  ['SendTask_', 'tasks'],
  ['ReceiveTask_', 'tasks'],
  ['SubProcess_', 'subprocesses'],
  ['CallActivity_', 'subprocesses'],
  ['Participant_', 'participants'],
  ['Lane_', 'lanes'],
];

/** Classify an element ID into a BPMN category for per-type match-rate reporting. */
function classifyElementId(id: string): string {
  for (const [prefix, type] of ELEMENT_TYPE_PREFIXES) {
    if (id.startsWith(prefix)) {
      return type;
    }
  }
  return 'other';
}

/** Per-type match rate entry. */
export interface TypeMatchRate {
  matched: number;
  total: number;
  matchRate: number;
}

/** Per-type match rates broken down by BPMN element category (I7-5). */
export type PerTypeMatchRates = Record<string, TypeMatchRate>;

/**
 * Compute per-type match rates from a set of normalised position deltas (I7-5).
 *
 * Groups `NormalisedDelta` entries by element type (events, gateways, tasks,
 * subprocesses, participants, lanes, other) and returns the match rate for
 * each group.  Useful for identifying which element categories drift most
 * from the reference layout.
 */
export function computePerTypeMatchRates(
  deltas: NormalisedDelta[],
  tolerance: number
): PerTypeMatchRates {
  const byType = new Map<string, { matched: number; total: number }>();

  for (const delta of deltas) {
    const type = classifyElementId(delta.elementId);
    if (!byType.has(type)) byType.set(type, { matched: 0, total: 0 });
    const entry = byType.get(type)!;
    entry.total++;
    if (Math.abs(delta.dx) <= tolerance && Math.abs(delta.dy) <= tolerance) {
      entry.matched++;
    }
  }

  const result: PerTypeMatchRates = {};
  for (const [type, { matched, total }] of byType) {
    result[type] = { matched, total, matchRate: total > 0 ? matched / total : 0 };
  }
  return result;
}
