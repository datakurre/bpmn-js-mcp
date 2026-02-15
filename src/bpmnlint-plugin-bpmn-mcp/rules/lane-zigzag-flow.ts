/**
 * Custom bpmnlint rule: lane-zigzag-flow
 *
 * Warns when sequence flows create a "zigzag" pattern across lanes:
 * LaneA → LaneB → LaneA. This pattern reduces readability and often
 * indicates that the middle element should be moved to the same lane
 * as its neighbors.
 *
 * The rule checks each flow node and looks at its incoming and outgoing
 * connections. If an element is in LaneB but both its predecessor and
 * successor are in LaneA, it reports a warning suggesting the element
 * be moved to LaneA.
 */

import { isType } from '../utils';

/**
 * Build a map of elementId → lane for fast lookup across all lane sets.
 * If an element appears in multiple lanes (modelling anomaly), use the
 * first assignment since it is the intended lane.
 */
function buildLaneMap(laneSets: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const laneSet of laneSets) {
    for (const lane of laneSet.lanes || []) {
      for (const ref of lane.flowNodeRef || []) {
        const refId = typeof ref === 'string' ? ref : ref.id;
        if (!map.has(refId)) {
          map.set(refId, lane);
        }
      }
    }
  }
  return map;
}

/**
 * Count total lanes across all lane sets.
 */
function countLanes(laneSets: any[]): number {
  let total = 0;
  for (const laneSet of laneSets) {
    total += (laneSet.lanes || []).length;
  }
  return total;
}

/**
 * Get cross-lane predecessors: incoming sequence flow source elements
 * that are in a different lane than the given element lane.
 */
function getCrossLanePredecessors(
  element: any,
  elementLane: any,
  elementToLane: Map<string, any>
): Array<{ element: any; lane: any }> {
  const result: Array<{ element: any; lane: any }> = [];
  for (const inFlow of element.incoming || []) {
    if (!isType(inFlow, 'bpmn:SequenceFlow')) continue;
    const pred = inFlow.sourceRef;
    if (!pred) continue;
    const predLane = elementToLane.get(pred.id);
    if (predLane && predLane.id !== elementLane.id) {
      result.push({ element: pred, lane: predLane });
    }
  }
  return result;
}

/**
 * Find a successor in the given lane via outgoing sequence flows.
 * Returns the first match or undefined.
 */
function findSuccessorInLane(
  element: any,
  targetLaneId: string,
  elementToLane: Map<string, any>
): any | undefined {
  for (const outFlow of element.outgoing || []) {
    if (!isType(outFlow, 'bpmn:SequenceFlow')) continue;
    const succ = outFlow.targetRef;
    if (!succ) continue;
    const succLane = elementToLane.get(succ.id);
    if (succLane && succLane.id === targetLaneId) return succ;
  }
  return undefined;
}

/**
 * Report a zigzag flow issue for the given element.
 */
function reportZigzag(
  element: any,
  elementLane: any,
  predecessor: any,
  successor: any,
  targetLane: any,
  reporter: any
): void {
  const predName = predecessor.name || predecessor.id;
  const elemName = element.name || element.id;
  const succName = successor.name || successor.id;
  const targetLaneName = targetLane.name || targetLane.id;
  const elemLaneName = elementLane.name || elementLane.id;
  reporter.report(
    element.id,
    `Zigzag flow detected: "${predName}" (${targetLaneName}) → ` +
      `"${elemName}" (${elemLaneName}) → ` +
      `"${succName}" (${targetLaneName}). ` +
      `Consider moving "${elemName}" to lane "${targetLaneName}" ` +
      `for simpler flow, or restructure the process to avoid ` +
      `unnecessary lane crossings.`
  );
}

/**
 * Check if a flow node has a zigzag pattern and report it.
 */
function checkElementForZigzag(
  element: any,
  elementLane: any,
  elementToLane: Map<string, any>,
  reporter: any
): void {
  const preds = getCrossLanePredecessors(element, elementLane, elementToLane);

  for (const { element: pred, lane: predLane } of preds) {
    const succ = findSuccessorInLane(element, predLane.id, elementToLane);
    if (succ) {
      reportZigzag(element, elementLane, pred, succ, predLane, reporter);
      return;
    }
  }
}

export default function laneZigzagFlow() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Process')) return;

    const laneSets = node.laneSets;
    if (!laneSets || laneSets.length === 0) return;
    if (countLanes(laneSets) < 2) return;

    const elementToLane = buildLaneMap(laneSets);

    for (const element of node.flowElements || []) {
      if (!isType(element, 'bpmn:FlowNode')) continue;
      const elementLane = elementToLane.get(element.id);
      if (!elementLane) continue;
      checkElementForZigzag(element, elementLane, elementToLane, reporter);
    }
  }

  return { check };
}
