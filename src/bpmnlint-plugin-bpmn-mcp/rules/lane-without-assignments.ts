/**
 * Custom bpmnlint rule: lane-without-assignments
 *
 * Warns when lanes exist in a process but user/manual tasks within
 * those lanes lack `camunda:assignee` or `camunda:candidateGroups`
 * properties. Lanes imply role-based organisation, so tasks should
 * have matching role assignments for the process to execute correctly.
 *
 * Only fires when at least 2 lanes exist (single-lane processes are
 * typically organisational placeholders).
 */

import { isType } from '../utils';

/** Task types that should have role assignments when placed in lanes. */
const ROLE_TASK_TYPES = ['bpmn:UserTask', 'bpmn:ManualTask'];

/**
 * Check whether an element has any Camunda role assignment.
 */
function hasRoleAssignment(el: any): boolean {
  const assignee = el.$attrs?.['camunda:assignee'] ?? el.assignee;
  const candidateUsers = el.$attrs?.['camunda:candidateUsers'] ?? el.candidateUsers;
  const candidateGroups = el.$attrs?.['camunda:candidateGroups'] ?? el.candidateGroups;
  return !!(assignee || candidateUsers || candidateGroups);
}

function countLanes(laneSets: any[]): number {
  let total = 0;
  for (const laneSet of laneSets) {
    total += (laneSet.lanes || []).length;
  }
  return total;
}

/** Collect all (lane, element) pairs from lane sets, deduplicating by element ID. */
function collectLaneElements(laneSets: any[]): Array<{ lane: any; el: any }> {
  const seen = new Set<string>();
  const pairs: Array<{ lane: any; el: any }> = [];
  for (const laneSet of laneSets) {
    for (const lane of laneSet.lanes || []) {
      for (const ref of lane.flowNodeRef || []) {
        const el = typeof ref === 'string' ? null : ref;
        if (!el || seen.has(el.id)) continue;
        seen.add(el.id);
        pairs.push({ lane, el });
      }
    }
  }
  return pairs;
}

/** Check a single element and report if it's a role task without an assignment. */
function reportIfMissingRole(el: any, lane: any, reporter: any): void {
  if (!ROLE_TASK_TYPES.some((t) => isType(el, t))) return;
  if (hasRoleAssignment(el)) return;

  reporter.report(
    el.id,
    `${el.$type.replace('bpmn:', '')} "${el.name || el.id}" is in lane ` +
      `"${lane.name || lane.id}" but has no camunda:assignee or camunda:candidateGroups. ` +
      `Use set_bpmn_element_properties to set a role assignment matching the lane.`
  );
}

export default function laneWithoutAssignments() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Process')) return;

    const laneSets = node.laneSets;
    if (!laneSets || laneSets.length === 0) return;
    if (countLanes(laneSets) < 2) return;

    for (const { lane, el } of collectLaneElements(laneSets)) {
      reportIfMissingRole(el, lane, reporter);
    }
  }

  return { check };
}
