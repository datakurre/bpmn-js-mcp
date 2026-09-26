/**
 * Custom bpmnlint rule: lane-overcrowding
 *
 * Warns when a lane contains more elements than can comfortably fit given
 * its height. The number of rows is counted from the elements' DI (elements
 * whose vertical extents overlap share a row); without DI it is estimated
 * as ceil(sqrt(N)).  Each row needs roughly 40px plus the lane margins.
 *
 * Only applies to processes that have at least 2 lanes.
 *
 * Uses a first-wins deduplication strategy for flowNodeRef to handle the
 * bpmn-js headless quirk where elements may appear in multiple lanes.
 */

import { isType } from '../utils';

/** Approximate vertical space needed per ROW of elements (element height + gap).
 *  Elements in BPMN lanes are primarily arranged horizontally. We estimate the
 *  number of vertical rows as ceil(sqrt(N)) for N elements, so this constant
 *  represents the height per row rather than per element. */
const VERTICAL_SPACE_PER_ELEMENT = 40;
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
 * Get the DI bounds of an element.
 */
function getShapeBounds(elementId: string, definitions: any): any {
  const diagrams = definitions?.diagrams;
  if (!diagrams) return undefined;

  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNShape') && el.bpmnElement?.id === elementId) {
        return el.bounds;
      }
    }
  }
  return undefined;
}

/**
 * Count the rows the lane's elements occupy, grouping elements whose
 * vertical extents overlap.  Falls back to ceil(sqrt(N)) without DI.
 */
function countRows(lane: any, elementCount: number, definitions: any): number {
  const extents = (lane.flowNodeRef || [])
    .map((ref: any) => getShapeBounds(typeof ref === 'string' ? ref : ref.id, definitions))
    .filter(Boolean)
    .map((b: any) => ({ top: b.y, bottom: b.y + b.height }))
    .sort((a: any, b: any) => a.top - b.top);
  if (extents.length === 0) return Math.max(1, Math.ceil(Math.sqrt(elementCount)));

  let rows = 1;
  let rowBottom = extents[0].bottom;
  for (const e of extents.slice(1)) {
    if (e.top < rowBottom) {
      rowBottom = Math.max(rowBottom, e.bottom);
    } else {
      rows++;
      rowBottom = e.bottom;
    }
  }
  return rows;
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

        const laneHeight = definitions ? getShapeBounds(lane.id, definitions)?.height : undefined;
        if (laneHeight === undefined) continue;

        // Minimum height for the rows of elements the lane actually holds.
        const estimatedRows = countRows(lane, elementCount, definitions);
        const minHeight = Math.max(
          MIN_LANE_HEIGHT,
          estimatedRows * VERTICAL_SPACE_PER_ELEMENT + 2 * LANE_MARGIN
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
