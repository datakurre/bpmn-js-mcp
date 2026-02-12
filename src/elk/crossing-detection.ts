/**
 * Post-layout crossing flow detection.
 *
 * Checks all pairs of connections for segment intersections and reports
 * the count of crossing pairs along with their IDs.
 */

import type { CrossingFlowsResult } from './types';
import type { ElementRegistry } from '../bpmn-types';
import { isConnection } from './helpers';

/**
 * Test whether two line segments intersect (excluding shared endpoints).
 * Uses the cross-product orientation test.
 */
function segmentsIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number }
): boolean {
  function cross(
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

/**
 * Detect crossing sequence flows after layout.
 *
 * Checks all pairs of connections for segment intersections and returns
 * the count of crossing pairs along with their IDs.
 */
export function detectCrossingFlows(elementRegistry: ElementRegistry): CrossingFlowsResult {
  const connections = elementRegistry.filter(
    (el) => isConnection(el.type) && !!el.waypoints && el.waypoints.length >= 2
  );

  const pairs: Array<[string, string]> = [];

  for (let i = 0; i < connections.length; i++) {
    for (let j = i + 1; j < connections.length; j++) {
      const wpsA = connections[i].waypoints!;
      const wpsB = connections[j].waypoints!;

      let found = false;
      for (let a = 0; a < wpsA.length - 1 && !found; a++) {
        for (let b = 0; b < wpsB.length - 1 && !found; b++) {
          if (segmentsIntersect(wpsA[a], wpsA[a + 1], wpsB[b], wpsB[b + 1])) {
            pairs.push([connections[i].id, connections[j].id]);
            found = true;
          }
        }
      }
    }
  }

  return { count: pairs.length, pairs };
}
