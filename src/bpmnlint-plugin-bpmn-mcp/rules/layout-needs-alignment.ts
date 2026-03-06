/**
 * Custom bpmnlint rule: layout-needs-alignment
 *
 * Warns when the visual layout of a BPMN diagram shows signs that it would
 * benefit from running layout_bpmn_diagram or align_bpmn_elements.
 *
 * Heuristics checked:
 * 1. **Non-orthogonal flows** — sequence flows with diagonal waypoint segments
 * 2. **Overlapping activities** — flow node shapes that overlap significantly
 * 3. **Excessive crossing flows** — many flow segments crossing each other
 * 4. **Suspiciously close activities** — flow node shapes within a few pixels of
 *    each other (near-overlap) suggesting a crowded layout
 *
 * Each heuristic contributes a score. If the combined score exceeds a threshold,
 * a single warning is reported on the process/collaboration suggesting a layout run.
 *
 * Uses DI (diagram interchange) bounds and waypoints from the BPMN XML.
 */

import { isType } from '../utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface ShapeEntry {
  elementId: string;
  bounds: Bounds;
  type: string;
}

interface EdgeEntry {
  elementId: string;
  waypoints: Point[];
  /** bpmnElement type (e.g. 'bpmn:SequenceFlow', 'bpmn:Association') */
  bpmnType?: string;
  /** sourceRef element ID (for bpmn:Association) */
  sourceRefId?: string;
  /** targetRef element ID (for bpmn:Association) */
  targetRefId?: string;
}

/* ------------------------------------------------------------------ */
/*  Thresholds                                                         */
/* ------------------------------------------------------------------ */

/** Minimum number of flow elements before the rule triggers at all. */
const MIN_FLOW_ELEMENTS = 4;

/** Angular tolerance (degrees) for "orthogonal" — small slopes are OK. */
const ORTHO_TOLERANCE_DEG = 3;

/** Minimum segment length to consider for orthogonality check. */
const MIN_SEGMENT_LENGTH = 10;

/** Minimum overlap area (px²) to count as overlapping shapes. */
const MIN_OVERLAP_AREA = 50;

/** Distance (px) below which two shapes are "suspiciously close". */
const CLOSE_DISTANCE_PX = 5;

/** Overall issue score threshold to emit a warning. */
const SCORE_THRESHOLD = 3;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Types to skip for shape overlap/proximity checks (containers, events). */
const SKIP_SHAPE_TYPES = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:Group',
  'bpmn:BoundaryEvent',
]);

/** Types to skip entirely when counting flow elements for the min-element gate. */
const FLOW_ELEMENT_TYPES = new Set([
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

function collectShapes(planeElements: any[]): ShapeEntry[] {
  const shapes: ShapeEntry[] = [];
  for (const el of planeElements) {
    if (!isType(el, 'bpmndi:BPMNShape')) continue;
    if (!el.bpmnElement || !el.bounds) continue;
    if (el.isLabel) continue;
    const bpmnType: string = el.bpmnElement.$type || '';
    if (SKIP_SHAPE_TYPES.has(bpmnType)) continue;
    shapes.push({
      elementId: el.bpmnElement.id,
      bounds: { x: el.bounds.x, y: el.bounds.y, width: el.bounds.width, height: el.bounds.height },
      type: bpmnType,
    });
  }
  return shapes;
}

function collectEdges(planeElements: any[]): EdgeEntry[] {
  const edges: EdgeEntry[] = [];
  for (const el of planeElements) {
    if (!isType(el, 'bpmndi:BPMNEdge')) continue;
    if (!el.bpmnElement) continue;
    const wps = el.waypoint;
    if (!wps || wps.length < 2) continue;
    const bpmnEl = el.bpmnElement;
    edges.push({
      elementId: bpmnEl.id,
      waypoints: wps.map((wp: any) => ({ x: wp.x, y: wp.y })),
      bpmnType: bpmnEl.$type,
      sourceRefId: bpmnEl.sourceRef?.id,
      targetRefId: bpmnEl.targetRef?.id,
    });
  }
  return edges;
}

function countFlowElements(planeElements: any[]): number {
  let count = 0;
  for (const el of planeElements) {
    if (!isType(el, 'bpmndi:BPMNShape')) continue;
    if (!el.bpmnElement) continue;
    if (el.isLabel) continue;
    const bpmnType: string = el.bpmnElement.$type || '';
    if (FLOW_ELEMENT_TYPES.has(bpmnType)) count++;
  }
  return count;
}

/* ------------------------------------------------------------------ */
/*  Heuristic 1: non-orthogonal flows                                  */
/* ------------------------------------------------------------------ */

function countFlowSegmentStats(edges: EdgeEntry[]): { total: number; nonOrthogonal: number } {
  const tolRad = (ORTHO_TOLERANCE_DEG * Math.PI) / 180;
  let total = 0;
  let nonOrthogonal = 0;

  for (const edge of edges) {
    const wps = edge.waypoints;
    for (let i = 0; i < wps.length - 1; i++) {
      const dx = wps[i + 1].x - wps[i].x;
      const dy = wps[i + 1].y - wps[i].y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < MIN_SEGMENT_LENGTH) continue;

      total++;
      const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
      // Orthogonal if close to 0 (horizontal) or π/2 (vertical)
      const isHorizontal = angle < tolRad;
      const isVertical = Math.abs(angle - Math.PI / 2) < tolRad;
      if (!isHorizontal && !isVertical) {
        nonOrthogonal++;
      }
    }
  }
  return { total, nonOrthogonal };
}

/* ------------------------------------------------------------------ */
/*  Heuristic 2: overlapping shapes                                    */
/* ------------------------------------------------------------------ */

function getOverlapArea(a: Bounds, b: Bounds): number {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlapX * overlapY;
}

/**
 * Check if outer fully contains inner (parent–child relationship).
 * Subprocesses contain their children geometrically — this is intentional,
 * not a layout defect that warrants an alignment warning.
 */
function boundsContains(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

function countOverlappingPairs(shapes: ShapeEntry[]): number {
  let count = 0;
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      // Skip parent–child containment (e.g. subprocess and its children).
      if (boundsContains(shapes[i].bounds, shapes[j].bounds)) continue;
      if (boundsContains(shapes[j].bounds, shapes[i].bounds)) continue;
      if (getOverlapArea(shapes[i].bounds, shapes[j].bounds) >= MIN_OVERLAP_AREA) {
        count++;
      }
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/*  Heuristic 3: crossing flows                                        */
/* ------------------------------------------------------------------ */

/** Check if two line segments (p1→p2 and p3→p4) cross. */
function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function countCrossingPairs(edges: EdgeEntry[]): number {
  // Collect all segments from all edges
  const segments: { from: Point; to: Point; edgeIdx: number }[] = [];
  for (let eIdx = 0; eIdx < edges.length; eIdx++) {
    const wps = edges[eIdx].waypoints;
    for (let i = 0; i < wps.length - 1; i++) {
      segments.push({ from: wps[i], to: wps[i + 1], edgeIdx: eIdx });
    }
  }

  let crossings = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      // Skip segments from the same edge (adjacent segments share a point)
      if (segments[i].edgeIdx === segments[j].edgeIdx) continue;
      if (segmentsCross(segments[i].from, segments[i].to, segments[j].from, segments[j].to)) {
        crossings++;
      }
    }
  }
  return crossings;
}

/* ------------------------------------------------------------------ */
/*  Heuristic 4: suspiciously close activities                         */
/* ------------------------------------------------------------------ */

function gapBetween(a: Bounds, b: Bounds): number {
  // Compute gap on each axis — negative means overlap
  const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
  const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);

  // If they don't overlap on either axis, the gap is the Chebyshev distance
  if (gapX > 0 && gapY > 0) return Math.max(gapX, gapY);
  if (gapX > 0) return gapX;
  if (gapY > 0) return gapY;
  // Overlapping — gap is 0 (or negative, handled by overlap heuristic)
  return 0;
}

function countCloseShapePairs(shapes: ShapeEntry[]): number {
  let count = 0;
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      // Skip parent–child containment.
      if (boundsContains(shapes[i].bounds, shapes[j].bounds)) continue;
      if (boundsContains(shapes[j].bounds, shapes[i].bounds)) continue;
      const gap = gapBetween(shapes[i].bounds, shapes[j].bounds);
      // Close but not overlapping
      if (gap > 0 && gap <= CLOSE_DISTANCE_PX) {
        count++;
      }
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/*  Heuristic 5: stale association waypoints                           */
/* ------------------------------------------------------------------ */

/**
 * Maximum distance (px) from element bounds for an association waypoint
 * to be considered "connected". If first/last waypoint is further away
 * than this, the association is likely stale (element moved after layout).
 *
 * NOTE: `layout_bpmn_diagram` never re-routes `bpmn:Association` edges,
 * so associations can be left behind when elements are repositioned.
 */
const ASSOC_WAYPOINT_TOLERANCE = 50;

/**
 * Check if a point is within tolerance px of the given element bounds.
 * The bounds represent the element's bounding box; the point should be
 * at or near the element's edge (where a connection would attach).
 */
function isPointNearBounds(p: Point, bounds: Bounds, tolerance: number): boolean {
  const nearX = p.x >= bounds.x - tolerance && p.x <= bounds.x + bounds.width + tolerance;
  const nearY = p.y >= bounds.y - tolerance && p.y <= bounds.y + bounds.height + tolerance;
  return nearX && nearY;
}

/**
 * Count bpmn:Association edges whose first or last waypoint is farther than
 * ASSOC_WAYPOINT_TOLERANCE from the source/target element bounds.
 * This detects stale associations left behind when elements were moved after
 * the association was created (layout_bpmn_diagram does not re-route them).
 */
function countStaleAssociationEdges(edges: EdgeEntry[], shapeMap: Map<string, Bounds>): number {
  let count = 0;
  for (const edge of edges) {
    if (edge.bpmnType !== 'bpmn:Association') continue;
    const wps = edge.waypoints;
    const firstWp = wps[0];
    const lastWp = wps[wps.length - 1];

    if (edge.sourceRefId) {
      const sourceBounds = shapeMap.get(edge.sourceRefId);
      if (sourceBounds && !isPointNearBounds(firstWp, sourceBounds, ASSOC_WAYPOINT_TOLERANCE)) {
        count++;
        continue;
      }
    }
    if (edge.targetRefId) {
      const targetBounds = shapeMap.get(edge.targetRefId);
      if (targetBounds && !isPointNearBounds(lastWp, targetBounds, ASSOC_WAYPOINT_TOLERANCE)) {
        count++;
      }
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/*  Per-plane analysis                                                 */
/* ------------------------------------------------------------------ */

function buildIssueDescription(
  nonOrtho: number,
  overlaps: number,
  crossings: number,
  close: number,
  staleAssociations: number,
  orthoPercent?: number
): string[] {
  const parts: string[] = [];
  if (nonOrtho > 0) {
    const pctSuffix = orthoPercent !== undefined ? ` (orthogonal flow: ${orthoPercent}%)` : '';
    parts.push(`${nonOrtho} non-orthogonal flow segment${nonOrtho > 1 ? 's' : ''}${pctSuffix}`);
  }
  if (overlaps > 0) parts.push(`${overlaps} overlapping shape pair${overlaps > 1 ? 's' : ''}`);
  if (crossings > 0) parts.push(`${crossings} crossing flow${crossings > 1 ? 's' : ''}`);
  if (close > 0) parts.push(`${close} suspiciously close shape pair${close > 1 ? 's' : ''}`);
  if (staleAssociations > 0) {
    parts.push(
      `${staleAssociations} association${staleAssociations > 1 ? 's' : ''} with stale waypoints ` +
        `(re-create via connect_bpmn_elements to fix — layout does not re-route associations)`
    );
  }
  return parts;
}

function analyzePlane(planeElements: any[], plane: any, fallbackNode: any, reporter: any): void {
  if (countFlowElements(planeElements) < MIN_FLOW_ELEMENTS) return;

  const shapes = collectShapes(planeElements);
  const edges = collectEdges(planeElements);

  // Build a map from bpmnElement id → bounds for association endpoint checks
  const shapeMap = new Map<string, Bounds>();
  for (const s of shapes) {
    shapeMap.set(s.elementId, s.bounds);
  }
  // Also include BoundaryEvent shapes (which are in collectShapes for DI but skipped for overlaps)
  for (const el of planeElements) {
    if (!isType(el, 'bpmndi:BPMNShape')) continue;
    if (!el.bpmnElement || !el.bounds || el.isLabel) continue;
    if (!shapeMap.has(el.bpmnElement.id)) {
      shapeMap.set(el.bpmnElement.id, {
        x: el.bounds.x,
        y: el.bounds.y,
        width: el.bounds.width,
        height: el.bounds.height,
      });
    }
  }

  const segStats = countFlowSegmentStats(edges);
  const nonOrthoSegments = segStats.nonOrthogonal;
  const totalSegments = segStats.total;
  const overlappingPairs = countOverlappingPairs(shapes);
  const crossingPairs = countCrossingPairs(edges);
  const closePairs = countCloseShapePairs(shapes);
  const staleAssociations = countStaleAssociationEdges(edges, shapeMap);

  // Weighted score: each issue type contributes to an overall "messiness" score
  const score =
    nonOrthoSegments * 1 + // each diagonal segment adds 1
    overlappingPairs * 3 + // overlapping shapes are a strong signal
    crossingPairs * 1 + // each crossing adds 1
    closePairs * 2 + // near-overlaps are a moderate signal
    staleAssociations * 3; // stale associations are a strong signal (layout won't fix them)

  if (score < SCORE_THRESHOLD) return;

  const orthoPercent =
    totalSegments > 0
      ? Math.round(((totalSegments - nonOrthoSegments) / totalSegments) * 100)
      : undefined;

  const issues = buildIssueDescription(
    nonOrthoSegments,
    overlappingPairs,
    crossingPairs,
    closePairs,
    staleAssociations,
    orthoPercent
  );
  const rootElement = plane.bpmnElement || fallbackNode;
  reporter.report(
    rootElement.id,
    `Diagram layout appears messy (score ${score}): ${issues.join(', ')}. ` +
      `Run layout_bpmn_diagram to auto-arrange elements, or use align_bpmn_elements to align specific groups.`
  );
}

/* ------------------------------------------------------------------ */
/*  Rule entry point                                                   */
/* ------------------------------------------------------------------ */

export default function layoutNeedsAlignment() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Definitions')) return;

    const diagrams = node.diagrams;
    if (!diagrams) return;

    for (const diagram of diagrams) {
      const plane = diagram?.plane;
      if (!plane?.planeElement) continue;
      analyzePlane(plane.planeElement, plane, node, reporter);
    }
  }

  return { check };
}
