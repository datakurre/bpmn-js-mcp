/**
 * Custom bpmnlint rule: lanes-expected-but-missing
 *
 * Warns when a collaboration has multiple expanded participants (pools)
 * and one or more of them contain multiple user tasks or manual tasks
 * (suggesting multiple roles/actors) but no lanes are defined.
 *
 * This is an opt-in heuristic: if a process has ≥ 3 user/manual tasks
 * and no laneSet, it's likely that the modeler should consider adding
 * lanes to clarify responsibilities.
 */

import { isType } from '../utils';

/** Minimum number of user/manual tasks before suggesting lanes. */
const MIN_TASKS_FOR_LANE_SUGGESTION = 3;

const LANE_RELEVANT_TYPES = ['bpmn:UserTask', 'bpmn:ManualTask'];

export default function lanesExpectedButMissing() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Process')) return;

    // Skip if lanes already exist
    const laneSets = node.laneSets;
    if (laneSets && laneSets.length > 0) {
      const totalLanes = laneSets.reduce(
        (sum: number, ls: any) => sum + (ls.lanes?.length || 0),
        0
      );
      if (totalLanes > 0) return;
    }

    // Count user/manual tasks in this process
    const flowElements = node.flowElements || [];
    const relevantTasks = flowElements.filter((el: any) =>
      LANE_RELEVANT_TYPES.some((t) => isType(el, t))
    );

    if (relevantTasks.length < MIN_TASKS_FOR_LANE_SUGGESTION) return;

    reporter.report(
      node.id,
      `Process has ${relevantTasks.length} user/manual tasks but no lanes. ` +
        `Consider adding lanes to clarify role assignments and responsibilities.`
    );
  }

  return { check };
}
