/**
 * Custom bpmnlint rule: lane-crossing-excessive
 *
 * Warns when more than 50% of sequence flows in a process cross lane
 * boundaries. Excessive lane crossings reduce readability and often
 * indicate that tasks should be reorganised into different lanes.
 *
 * Only applies to processes that actually have lanes defined.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

/** Threshold: warn when more than this fraction of flows cross lanes. */
const CROSSING_THRESHOLD = 0.5;

/** Minimum number of sequence flows to trigger the rule (avoid noise on tiny diagrams). */
const MIN_FLOWS = 4;

/**
 * Build a map of elementId → laneId for fast lookup across all lane sets.
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

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Process')) return;

    const laneSets = node.laneSets;
    if (!laneSets || laneSets.length === 0) return;
    if (countLanes(laneSets) < 2) return;

    const laneMap = buildLaneMap(laneSets);
    const flowElements = node.flowElements || [];

    // Count sequence flows and lane crossings
    const sequenceFlows = flowElements.filter((el: any) => isType(el, 'bpmn:SequenceFlow'));
    if (sequenceFlows.length < MIN_FLOWS) return;

    let crossings = 0;
    for (const flow of sequenceFlows) {
      const sourceId = flow.sourceRef?.id;
      const targetId = flow.targetRef?.id;
      if (!sourceId || !targetId) continue;

      const sourceLane = laneMap.get(sourceId);
      const targetLane = laneMap.get(targetId);

      // Only count as crossing if both elements are in lanes and they differ
      if (sourceLane && targetLane && sourceLane !== targetLane) {
        crossings++;
      }
    }

    const ratio = crossings / sequenceFlows.length;
    if (ratio >= CROSSING_THRESHOLD) {
      const pct = Math.round(ratio * 100);
      reporter.report(
        node.id,
        `${pct}% of sequence flows (${crossings}/${sequenceFlows.length}) cross lane boundaries. ` +
          `Consider reorganizing tasks into lanes to reduce cross-lane flows.`
      );
    }
  }

  return { check };
}

export default ruleFactory;
