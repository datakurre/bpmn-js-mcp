/**
 * Custom bpmnlint rule: lane-single-element
 *
 * Reports an info-level hint when a lane contains only 1–2 flow node
 * elements. Such lanes add visual complexity without providing meaningful
 * role separation — the elements could likely be merged into an adjacent lane.
 *
 * Only applies to processes that have at least 2 lanes (otherwise the
 * single lane is just the default container).
 *
 * Uses a first-wins deduplication strategy for flowNodeRef to handle the
 * bpmn-js headless quirk where elements may appear in multiple lanes.
 */

import { isType } from '../utils';

/** Maximum number of elements for a lane to be considered "sparse". */
const MAX_SPARSE_ELEMENTS = 2;

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
 * Build a deduplicated map of laneId → Set<elementId> using first-wins
 * strategy (same as lane-zigzag-flow.ts). This handles the bpmn-js
 * headless quirk where elements may appear in multiple lanes' flowNodeRef.
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

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Process')) return;

    const laneSets = node.laneSets;
    if (!laneSets || laneSets.length === 0) return;
    if (countLanes(laneSets) < 2) return;

    const laneCounts = buildLaneElementCounts(laneSets);

    for (const laneSet of laneSets) {
      for (const lane of laneSet.lanes || []) {
        const count = laneCounts.get(lane.id) || 0;

        if (count > 0 && count <= MAX_SPARSE_ELEMENTS) {
          const laneName = lane.name || lane.id;
          reporter.report(
            lane.id,
            `Lane "${laneName}" contains only ${count} element(s). ` +
              `Consider merging with another lane or adding related tasks.`
          );
        }
      }
    }
  }

  return { check };
}

export default ruleFactory;
