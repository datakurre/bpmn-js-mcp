/**
 * Custom bpmnlint rule: message-flow-crossing-excessive
 *
 * Warns when a message flow crosses more than a threshold number of
 * sequence flows, suggesting element repositioning to reduce visual clutter.
 *
 * This rule uses DI waypoints to detect geometric intersections between
 * message flows and sequence flows. Crossings are computed using segment
 * intersection tests on the BPMNEdge waypoints.
 */

import { isType } from '../utils';

/** Maximum allowed crossings per message flow before warning. */
const MAX_CROSSINGS = 2;

import type { Point } from '../../geometry';

/**
 * Determine if two line segments (p1→p2) and (p3→p4) intersect.
 * Uses the cross-product orientation test.
 */
function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  // Collinear cases
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;

  return false;
}

function direction(pi: Point, pj: Point, pk: Point): number {
  return (pk.x - pi.x) * (pj.y - pi.y) - (pj.x - pi.x) * (pk.y - pi.y);
}

function onSegment(pi: Point, pj: Point, pk: Point): boolean {
  return (
    Math.min(pi.x, pj.x) <= pk.x &&
    pk.x <= Math.max(pi.x, pj.x) &&
    Math.min(pi.y, pj.y) <= pk.y &&
    pk.y <= Math.max(pi.y, pj.y)
  );
}

/**
 * Count how many times a polyline (message flow) crosses another polyline (sequence flow).
 */
function countCrossings(mfWaypoints: Point[], sfWaypoints: Point[]): number {
  let crossings = 0;
  for (let i = 0; i < mfWaypoints.length - 1; i++) {
    for (let j = 0; j < sfWaypoints.length - 1; j++) {
      if (
        segmentsIntersect(mfWaypoints[i], mfWaypoints[i + 1], sfWaypoints[j], sfWaypoints[j + 1])
      ) {
        crossings++;
      }
    }
  }
  return crossings;
}

/**
 * Build a map of element ID → waypoints from BPMNEdge DI elements.
 */
function buildEdgeMap(definitions: any): Map<string, Point[]> {
  const map = new Map<string, Point[]>();
  const diagrams = definitions?.diagrams;
  if (!diagrams) return map;

  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNEdge') && el.bpmnElement?.id) {
        const wps = el.waypoint;
        if (wps && wps.length >= 2) {
          map.set(
            el.bpmnElement.id,
            wps.map((wp: any) => ({ x: wp.x, y: wp.y }))
          );
        }
      }
    }
  }
  return map;
}

/**
 * Collect all sequence flow IDs from all processes in the definitions.
 */
function collectSequenceFlowIds(definitions: any): Set<string> {
  const ids = new Set<string>();
  const rootElements = definitions?.rootElements || [];
  for (const re of rootElements) {
    if (isType(re, 'bpmn:Process')) {
      for (const el of re.flowElements || []) {
        if (isType(el, 'bpmn:SequenceFlow')) {
          ids.add(el.id);
        }
      }
    }
  }
  return ids;
}

export default function messageFlowCrossingExcessive() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Collaboration')) return;

    const messageFlows = node.messageFlows || [];
    if (messageFlows.length === 0) return;

    const definitions = node.$parent;
    const edgeMap = buildEdgeMap(definitions);
    const sequenceFlowIds = collectSequenceFlowIds(definitions);

    // Get waypoints for all sequence flows
    const sfEdges: Array<{ id: string; waypoints: Point[] }> = [];
    for (const sfId of sequenceFlowIds) {
      const wps = edgeMap.get(sfId);
      if (wps) {
        sfEdges.push({ id: sfId, waypoints: wps });
      }
    }

    if (sfEdges.length === 0) return;

    for (const mf of messageFlows) {
      const mfWaypoints = edgeMap.get(mf.id);
      if (!mfWaypoints) continue;

      let totalCrossings = 0;
      for (const sf of sfEdges) {
        totalCrossings += countCrossings(mfWaypoints, sf.waypoints);
      }

      if (totalCrossings > MAX_CROSSINGS) {
        const sourceName = mf.sourceRef?.name || mf.sourceRef?.id || '?';
        const targetName = mf.targetRef?.name || mf.targetRef?.id || '?';
        reporter.report(
          mf.id,
          `Message flow from "${sourceName}" to "${targetName}" crosses ` +
            `${totalCrossings} sequence flows (threshold: ${MAX_CROSSINGS}). ` +
            'Consider repositioning the connected elements or pools to reduce visual clutter.'
        );
      }
    }
  }

  return { check };
}
