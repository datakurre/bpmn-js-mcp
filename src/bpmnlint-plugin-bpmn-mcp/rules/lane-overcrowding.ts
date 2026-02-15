/**
 * Custom bpmnlint rule: lane-overcrowding
 *
 * Warns when a lane contains more elements than can comfortably fit given
 * its height. Uses a density heuristic: each flow node needs approximately
 * 80px of vertical space (element height + spacing). If the lane height
 * is insufficient for the assigned elements, this rule fires.
 *
 * Only applies to processes that have at least 2 lanes.
 *
 * Uses a first-wins deduplication strategy for flowNodeRef to handle the
 * bpmn-js headless quirk where elements may appear in multiple lanes.
 */

import { isType } from '../utils';

/** Approximate vertical space needed per flow node in a lane (element height + gap). */
const VERTICAL_SPACE_PER_ELEMENT = 80;
/** Minimum recommended lane height for any lane with elements. */
const MIN_LANE_HEIGHT = 120;
/** Top and bottom margin inside a lane. */
const LANE_MARGIN = 40;

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
 * Get lane height from DI.
 */
function getLaneHeight(laneId: string, definitions: any): number | undefined {
  const diagrams = definitions?.diagrams;
  if (!diagrams) return undefined;

  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNShape') && el.bpmnElement?.id === laneId) {
        return el.bounds?.height;
      }
    }
  }
  return undefined;
}

/**
 * Build a deduplicated map of laneId → element count using first-wins strategy.
 */
function buildLaneElementCounts(laneSets: any[]): Map<string, number> {
  const assigned = new Set<string>();
  const counts = new Map<string, number>();

  for (const laneSet of laneSets) {
    for (const lane of laneSet.lanes || []) {
      let count = 0;
      for (const ref of lane.flowNodeRef || []) {
        const refId = typeof ref === 'string' ? ref : ref.id;
        if (!assigned.has(refId)) {
          assigned.add(refId);
          count++;
        }
      }
      counts.set(lane.id, count);
    }
  }
  return counts;
}

export default function laneOvercrowding() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Process')) return;

    const laneSets = node.laneSets;
    if (!laneSets || laneSets.length === 0) return;
    if (countLanes(laneSets) < 2) return;

    // Find the root definitions to access DI
    let definitions = node.$parent;
    while (definitions && !isType(definitions, 'bpmn:Definitions')) {
      definitions = definitions.$parent;
    }

    const laneCounts = buildLaneElementCounts(laneSets);

    for (const laneSet of laneSets) {
      for (const lane of laneSet.lanes || []) {
        const elementCount = laneCounts.get(lane.id) || 0;
        if (elementCount === 0) continue;

        const laneHeight = definitions ? getLaneHeight(lane.id, definitions) : undefined;
        if (laneHeight === undefined) continue;

        // Calculate minimum height needed for the elements
        // Elements can be arranged in rows; estimate rows needed
        const minHeight = Math.max(
          MIN_LANE_HEIGHT,
          elementCount * VERTICAL_SPACE_PER_ELEMENT + 2 * LANE_MARGIN
        );

        if (laneHeight < minHeight) {
          const laneName = lane.name || lane.id;
          reporter.report(
            lane.id,
            `Lane "${laneName}" contains ${elementCount} elements but is only ${Math.round(laneHeight)}px tall ` +
              `(recommended: ≥${minHeight}px). ` +
              'Consider increasing the lane height or redistributing elements across lanes. ' +
              'Use move_bpmn_element with height to resize the lane, or run layout_bpmn_diagram to auto-arrange.'
          );
        }
      }
    }
  }

  return { check };
}
