/**
 * Custom bpmnlint rule: long-message-flow-path
 *
 * Warns when a message flow path exceeds a threshold length (default 500px).
 * Long message flows create visual clutter and suggest the sending/receiving
 * elements should be repositioned closer together, or the pools should be
 * vertically aligned to reduce diagonal crossings.
 *
 * Length is computed from the DI waypoints. Flows without DI are skipped.
 */

import { isType } from '../utils';

/** Maximum message flow path length in pixels before warning. */
const MAX_MESSAGE_FLOW_LENGTH = 500;

interface Point {
  x: number;
  y: number;
}

/**
 * Compute the total polyline length from a list of waypoints.
 */
function pathLength(waypoints: Point[]): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/**
 * Find the BPMNEdge DI for a given element ID and return its waypoints.
 */
function findEdgeWaypoints(elementId: string, definitions: any): Point[] | null {
  const diagrams = definitions?.diagrams;
  if (!diagrams) return null;

  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNEdge') && el.bpmnElement?.id === elementId) {
        const wps = el.waypoint;
        if (wps && wps.length >= 2) {
          return wps.map((wp: any) => ({ x: wp.x, y: wp.y }));
        }
      }
    }
  }
  return null;
}

export default function longMessageFlowPath() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Collaboration')) return;

    const messageFlows = node.messageFlows || [];
    if (messageFlows.length === 0) return;

    const definitions = node.$parent;

    for (const mf of messageFlows) {
      const waypoints = findEdgeWaypoints(mf.id, definitions);
      if (!waypoints) continue;

      const length = pathLength(waypoints);
      if (length > MAX_MESSAGE_FLOW_LENGTH) {
        const sourceName = mf.sourceRef?.name || mf.sourceRef?.id || '?';
        const targetName = mf.targetRef?.name || mf.targetRef?.id || '?';
        reporter.report(
          mf.id,
          `Message flow from "${sourceName}" to "${targetName}" is ${Math.round(length)}px long ` +
            `(threshold: ${MAX_MESSAGE_FLOW_LENGTH}px). Consider repositioning the elements ` +
            `closer together or aligning the pools vertically to reduce visual clutter.`
        );
      }
    }
  }

  return { check };
}
