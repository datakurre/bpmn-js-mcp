/**
 * Custom bpmnlint rule: lane-missing-start-or-end
 *
 * Warns when a lane contains task elements but has no start event or end
 * event among its flow nodes. This may indicate incomplete process flow
 * or improper lane organization — typically at least one lane should
 * contain the process start and at least one should contain an end event.
 *
 * This is a process-level check: it verifies that across all lanes,
 * at least one lane has a start event and at least one lane has an end event.
 * Individual lanes without start/end events are fine as long as the process
 * has them somewhere.
 *
 * Uses a first-wins deduplication strategy for flowNodeRef to handle the
 * bpmn-js headless quirk where elements may appear in multiple lanes.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

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
 * Build a deduplicated map of elementId → laneId using first-wins strategy.
 */
function buildLaneMap(laneSets: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const laneSet of laneSets) {
    for (const lane of laneSet.lanes || []) {
      for (const ref of lane.flowNodeRef || []) {
        const refId = typeof ref === 'string' ? ref : ref.id;
        if (!map.has(refId)) {
          map.set(refId, lane.id);
        }
      }
    }
  }
  return map;
}

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Process')) return;

    const laneSets = node.laneSets;
    if (!laneSets || laneSets.length === 0) return;
    if (countLanes(laneSets) < 2) return;

    const flowElements = node.flowElements || [];
    const laneMap = buildLaneMap(laneSets);

    // Check if any deduplicated lane assignment includes a start or end event
    let anyLaneHasStart = false;
    let anyLaneHasEnd = false;

    for (const el of flowElements) {
      if (!laneMap.has(el.id)) continue;
      if (isType(el, 'bpmn:StartEvent')) {
        anyLaneHasStart = true;
      }
      if (isType(el, 'bpmn:EndEvent')) {
        anyLaneHasEnd = true;
      }
    }

    if (!anyLaneHasStart) {
      reporter.report(
        node.id,
        'No lane contains a start event. Verify that process flow is ' +
          'complete and assign the start event to the appropriate lane.'
      );
    }

    if (!anyLaneHasEnd) {
      reporter.report(
        node.id,
        'No lane contains an end event. Verify that process flow is ' +
          'complete and assign the end event to the appropriate lane.'
      );
    }
  }

  return { check };
}

export default ruleFactory;
