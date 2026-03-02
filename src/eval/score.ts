import {
  cloneWaypoints,
  deduplicateWaypoints,
  rectsNearby,
  rectsOverlap,
  segmentsIntersect,
} from '../geometry';
import type { ListedElement, LayoutMetrics } from './types';

const GRID = 10;

function isConnection(type: string): boolean {
  return (
    type === 'bpmn:SequenceFlow' ||
    type === 'bpmn:MessageFlow' ||
    type === 'bpmn:Association' ||
    type.endsWith('Flow')
  );
}

function isContainer(type: string): boolean {
  return type === 'bpmn:Participant' || type === 'bpmn:Lane';
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function segmentEndpointProximity(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
  eps = 3
): boolean {
  // If any endpoints are very close, treat as non-crossing (shared vertex / touching).
  return dist(a1, b1) <= eps || dist(a1, b2) <= eps || dist(a2, b1) <= eps || dist(a2, b2) <= eps;
}

function gridSnap01(value: number | undefined): number {
  if (value === undefined) return 0;
  const mod = Math.abs(value % GRID);
  const d = Math.min(mod, GRID - mod);
  // 0px away => 1. 5px or more away => 0.
  return clamp(1 - d / (GRID / 2), 0, 1);
}

function splitElements(elements: ListedElement[]): {
  shapes: ListedElement[];
  flows: ListedElement[];
} {
  const shapes = elements.filter((e) => !isConnection(e.type) && !isContainer(e.type));
  const flows = elements.filter((e) => isConnection(e.type));
  return { shapes, flows };
}

function computeOverlapAndNearMisses(shapes: ListedElement[]): {
  overlaps: number;
  nearMisses: number;
} {
  let overlaps = 0;
  let nearMisses = 0;

  // Boundary events naturally overlap their host task — exclude them.
  const nonBoundary = shapes.filter((s) => s.type !== 'bpmn:BoundaryEvent');

  for (let i = 0; i < nonBoundary.length; i++) {
    const a = nonBoundary[i];
    if (a.x === undefined || a.y === undefined || a.width === undefined || a.height === undefined) {
      continue;
    }
    const ra = { x: a.x, y: a.y, width: a.width, height: a.height };
    for (let j = i + 1; j < nonBoundary.length; j++) {
      const b = nonBoundary[j];
      if (
        b.x === undefined ||
        b.y === undefined ||
        b.width === undefined ||
        b.height === undefined
      ) {
        continue;
      }
      const rb = { x: b.x, y: b.y, width: b.width, height: b.height };
      if (rectsOverlap(ra, rb)) overlaps++;
      else if (rectsNearby(ra, rb, 15)) nearMisses++;
    }
  }

  return { overlaps, nearMisses };
}

type Segment = { p1: { x: number; y: number }; p2: { x: number; y: number } };
type FlowSegments = Map<string, { sourceId?: string; targetId?: string; segments: Segment[] }>;

/**
 * Return true when a left-to-right flow exits its source element from the
 * top or bottom instead of the right edge (vertical-dominant first segment
 * for a flow whose overall direction is to the right).
 *
 * Excludes gateway sources (legitimate vertical exits for branching) and
 * boundary event sources (attached to task edge, complex routing).
 */
function isWrongExitFlow(
  segs: Segment[],
  start: { x: number; y: number },
  end: { x: number; y: number },
  srcEl: ListedElement | undefined
): boolean {
  if (segs.length < 1 || end.x <= start.x + 30) return false;
  const srcType = srcEl?.type ?? '';
  if (srcType.includes('Gateway') || srcType === 'bpmn:BoundaryEvent') return false;
  const seg0 = segs[0];
  const dx0 = Math.abs(seg0.p2.x - seg0.p1.x);
  const dy0 = Math.abs(seg0.p2.y - seg0.p1.y);
  return dy0 > dx0 * 2 && dy0 > 40;
}

function buildFlowSegments(
  flows: ListedElement[],
  shapes: ListedElement[]
): {
  flowSegments: FlowSegments;
  bendCount: number;
  diagonalSegments: number;
  detourRatioAvg: number;
  wrongExitFlows: number;
} {
  let bendCount = 0;
  let diagonalSegments = 0;
  let wrongExitFlows = 0;
  const detourRatios: number[] = [];
  const flowSegments: FlowSegments = new Map();

  // Build shape lookup for source-type checking in wrong-exit detection.
  const shapeById = new Map<string, ListedElement>();
  for (const s of shapes) shapeById.set(s.id, s);

  for (const f of flows) {
    if (!f.waypoints || f.waypoints.length < 2) continue;
    const wps = deduplicateWaypoints(cloneWaypoints(f.waypoints), 1);
    if (wps.length < 2) continue;

    bendCount += Math.max(0, wps.length - 2);

    const segs: Segment[] = [];
    let pathLen = 0;
    for (let i = 0; i < wps.length - 1; i++) {
      const p1 = wps[i];
      const p2 = wps[i + 1];
      segs.push({ p1, p2 });
      pathLen += dist(p1, p2);

      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);
      if (dx !== 0 && dy !== 0) diagonalSegments++;
    }

    const start = wps[0];
    const end = wps[wps.length - 1];
    const manhattan = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (manhattan > 0) detourRatios.push(pathLen / manhattan);

    // Detect wrong-exit direction via extracted helper.
    const srcEl = f.sourceId ? shapeById.get(f.sourceId) : undefined;
    if (isWrongExitFlow(segs, start, end, srcEl)) wrongExitFlows++;

    flowSegments.set(f.id, { sourceId: f.sourceId, targetId: f.targetId, segments: segs });
  }

  const detourRatioAvg = detourRatios.length
    ? detourRatios.reduce((a, b) => a + b, 0) / detourRatios.length
    : 1;

  return { flowSegments, bendCount, diagonalSegments, detourRatioAvg, wrongExitFlows };
}

function computeCrossings(flowSegments: FlowSegments): number {
  let crossings = 0;
  const ids = [...flowSegments.keys()];

  for (let i = 0; i < ids.length; i++) {
    const fa = flowSegments.get(ids[i])!;
    for (let j = i + 1; j < ids.length; j++) {
      const fb = flowSegments.get(ids[j])!;

      if (
        (fa.sourceId && (fa.sourceId === fb.sourceId || fa.sourceId === fb.targetId)) ||
        (fa.targetId && (fa.targetId === fb.sourceId || fa.targetId === fb.targetId))
      ) {
        continue;
      }

      crossings += countCrossingsBetweenFlows(fa.segments, fb.segments);
    }
  }

  return crossings;
}

function countCrossingsBetweenFlows(a: Segment[], b: Segment[]): number {
  let c = 0;
  for (const sa of a) {
    for (const sb of b) {
      if (segmentEndpointProximity(sa.p1, sa.p2, sb.p1, sb.p2, 3)) continue;
      if (segmentsIntersect(sa.p1, sa.p2, sb.p1, sb.p2)) c++;
    }
  }
  return c;
}

function computeGridSnapAvg(shapes: ListedElement[]): number {
  const gridSnaps: number[] = [];
  for (const s of shapes) {
    gridSnaps.push(gridSnap01(s.x));
    gridSnaps.push(gridSnap01(s.y));
  }
  return gridSnaps.length ? gridSnaps.reduce((a, b) => a + b, 0) / gridSnaps.length : 1;
}

/** Build predecessor/successor adjacency sets from flow elements. */
function buildAdjacency(flows: ListedElement[]): {
  predecessors: Map<string, Set<string>>;
  successors: Map<string, Set<string>>;
} {
  const predecessors = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  for (const f of flows) {
    if (!f.sourceId || !f.targetId) continue;
    if (!predecessors.has(f.targetId)) predecessors.set(f.targetId, new Set());
    predecessors.get(f.targetId)!.add(f.sourceId);
    if (!successors.has(f.sourceId)) successors.set(f.sourceId, new Set());
    successors.get(f.sourceId)!.add(f.targetId);
  }
  return { predecessors, successors };
}

/** Returns true when two elements share a direct common predecessor or successor (gateway branches). */
function areGatewayBranches(
  aId: string,
  bId: string,
  predecessors: Map<string, Set<string>>,
  successors: Map<string, Set<string>>
): boolean {
  const ap = predecessors.get(aId);
  const bp = predecessors.get(bId);
  if (ap && bp) {
    for (const p of ap) if (bp.has(p)) return true;
  }
  const as_ = successors.get(aId);
  const bs = successors.get(bId);
  if (as_ && bs) {
    for (const s of as_) if (bs.has(s)) return true;
  }
  return false;
}

/** Group shapes by approximate X position (layer). */
function groupByLayer(shapes: ListedElement[], tolerance: number): Map<number, ListedElement[]> {
  const layers = new Map<number, ListedElement[]>();
  for (const s of shapes) {
    if (s.x === undefined || s.y === undefined) continue;
    let layerKey = -1;
    for (const key of layers.keys()) {
      if (Math.abs(s.x - key) <= tolerance) {
        layerKey = key;
        break;
      }
    }
    if (layerKey === -1) {
      layerKey = s.x;
      layers.set(layerKey, []);
    }
    layers.get(layerKey)!.push(s);
  }
  return layers;
}

/**
 * Compute horizontal alignment metric.
 *
 * Groups elements by approximate X position (layer) and counts how many
 * pairs within the same layer have Y positions that differ by more than
 * the alignment threshold (20px).
 *
 * Pairs that share a common direct predecessor or successor are skipped —
 * those are gateway branches and intentionally placed at different Y levels.
 */
function computeHorizontalMisalignments(shapes: ListedElement[], flows: ListedElement[]): number {
  const LAYER_TOLERANCE = 30;
  const ALIGNMENT_THRESHOLD = 20;

  const { predecessors, successors } = buildAdjacency(flows);
  const layers = groupByLayer(shapes, LAYER_TOLERANCE);

  let misalignments = 0;
  for (const layer of layers.values()) {
    if (layer.length < 2) continue;
    for (let i = 0; i < layer.length; i++) {
      for (let j = i + 1; j < layer.length; j++) {
        if (areGatewayBranches(layer[i].id, layer[j].id, predecessors, successors)) continue;
        const yDiff = Math.abs((layer[i].y ?? 0) - (layer[j].y ?? 0));
        if (yDiff > ALIGNMENT_THRESHOLD) misalignments++;
      }
    }
  }

  return misalignments;
}

/**
 * Compute vertical balance metric for gateway split patterns.
 *
 * For each gateway that splits to multiple branches, measures how
 * symmetrically the branches are distributed around the gateway's Y center.
 *
 * Returns the total imbalance score (0 = perfectly balanced).
 */
function computeVerticalImbalance(shapes: ListedElement[], flows: ListedElement[]): number {
  // Build adjacency from flows
  const outgoing = new Map<string, string[]>();
  for (const f of flows) {
    if (!f.sourceId || !f.targetId) continue;
    if (!outgoing.has(f.sourceId)) outgoing.set(f.sourceId, []);
    outgoing.get(f.sourceId)!.push(f.targetId);
  }

  // Build element lookup
  const elementsById = new Map<string, ListedElement>();
  for (const s of shapes) elementsById.set(s.id, s);

  let totalImbalance = 0;

  // Find gateways with multiple outgoing flows (splits)
  for (const s of shapes) {
    if (!s.type?.includes('Gateway')) continue;
    const targets = outgoing.get(s.id) ?? [];
    if (targets.length < 2) continue;

    // Get Y positions of targets
    const targetYs: number[] = [];
    for (const tid of targets) {
      const t = elementsById.get(tid);
      if (t?.y !== undefined && t?.height !== undefined) {
        targetYs.push(t.y + t.height / 2); // center Y
      }
    }

    if (targetYs.length < 2) continue;

    // Gateway center Y
    const gatewayY = (s.y ?? 0) + (s.height ?? 0) / 2;

    // Measure imbalance: average deviation from gateway center
    const deviations = targetYs.map((y) => y - gatewayY);
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;

    // Imbalance is how far the average deviation is from 0
    // (0 means branches are centered around gateway)
    totalImbalance += Math.abs(avgDeviation) / 50; // normalize to ~1 per 50px offset
  }

  return totalImbalance;
}

export function computeLayoutMetrics(
  elements: ListedElement[],
  lintErrors = 0,
  lintWarnings = 0
): LayoutMetrics {
  const { shapes, flows } = splitElements(elements);
  const { overlaps, nearMisses } = computeOverlapAndNearMisses(shapes);
  const { flowSegments, bendCount, diagonalSegments, detourRatioAvg, wrongExitFlows } =
    buildFlowSegments(flows, shapes);
  const crossings = computeCrossings(flowSegments);
  const gridSnapAvg = computeGridSnapAvg(shapes);
  const horizontalMisalignments = computeHorizontalMisalignments(shapes, flows);
  const verticalImbalance = computeVerticalImbalance(shapes, flows);

  return {
    nodeCount: shapes.length,
    flowCount: flows.length,
    overlaps,
    nearMisses,
    crossings,
    bendCount,
    diagonalSegments,
    detourRatioAvg,
    gridSnapAvg,
    horizontalMisalignments,
    verticalImbalance,
    wrongExitFlows,
    lintErrors,
    lintWarnings,
  };
}

export function scoreLayout(metrics: LayoutMetrics): {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
} {
  // Start at 100 and subtract penalties. Weights are intentionally simple and stable.
  let score = 100;

  score -= metrics.overlaps * 25;
  score -= metrics.crossings * 12;

  score -= metrics.diagonalSegments * 2;
  score -= metrics.bendCount * 1.5;
  score -= metrics.nearMisses * 0.5;

  // Penalize detours above ~1.2x. (1.0 is ideal.)
  if (metrics.detourRatioAvg > 1.2) score -= (metrics.detourRatioAvg - 1.2) * 30;

  // Wrong-exit penalty: each flow leaving its source from top/bottom instead
  // of the right edge produces a U-shape or reversed L-path.
  score -= metrics.wrongExitFlows * 5;

  // Grid snap: 1 is ideal.
  score -= (1 - metrics.gridSnapAvg) * 10;

  // Alignment penalties (new metrics for balanced layout)
  score -= metrics.horizontalMisalignments * 3;
  score -= metrics.verticalImbalance * 2;

  // Camunda 7 executability penalties (lint integration)
  score -= metrics.lintErrors * 15;
  score -= metrics.lintWarnings * 3;

  score = clamp(score, 0, 100);

  const grade: 'A' | 'B' | 'C' | 'D' | 'F' =
    score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  return { score, grade };
}
