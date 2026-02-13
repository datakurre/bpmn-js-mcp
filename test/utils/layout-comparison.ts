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
