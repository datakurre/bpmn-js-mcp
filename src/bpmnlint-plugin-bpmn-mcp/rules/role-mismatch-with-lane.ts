/**
 * Custom bpmnlint rule: role-mismatch-with-lane
 *
 * Warns when a user task's `camunda:assignee` or `camunda:candidateGroups`
 * does not match the name of the lane it is placed in. This helps ensure
 * that tasks are assigned to the correct organizational role as depicted
 * by the lane structure.
 *
 * The matching is fuzzy: it normalises both the lane name and the
 * assignee/group values to lowercase and checks for substring containment.
 * For example, lane "Customer Support" would match assignee "customer_support"
 * or candidateGroups "customerSupport".
 *
 * Only fires on user tasks that have explicit assignee/candidateGroups AND
 * are placed in a named lane.
 */

import { isType } from '../utils';

/**
 * Normalise a string for fuzzy comparison: lowercase, strip common separators.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_\s]+/g, '') // Remove separators
    .replace(/([a-z])([A-Z])/g, '$1$2'.toLowerCase()); // camelCase → flat
}

/**
 * Check if two strings match fuzzily (one contains the other after normalisation).
 */
function fuzzyMatch(a: string, b: string): boolean {
  const na = normalise(a);
  const nb = normalise(b);
  return na.includes(nb) || nb.includes(na);
}

/**
 * Build a map of elementId → lane for all lanes in a process.
 * Uses first-wins deduplication for bpmn-js headless quirk.
 */
function buildElementToLaneMap(laneSets: any[]): Map<string, any> {
  const elementToLane = new Map<string, any>();

  for (const laneSet of laneSets) {
    for (const lane of laneSet.lanes || []) {
      for (const ref of lane.flowNodeRef || []) {
        const refId = typeof ref === 'string' ? ref : ref.id;
        if (!elementToLane.has(refId)) {
          elementToLane.set(refId, lane);
        }
      }
    }
  }
  return elementToLane;
}

/**
 * Get Camunda extension attribute value from a node.
 */
function getCamundaAttr(node: any, attr: string): string | undefined {
  // Try direct access (moddle normalisation)
  const prefixed = `camunda:${attr}`;
  if (node.$attrs?.[prefixed]) return node.$attrs[prefixed];
  if (node[attr]) return node[attr];
  // Try via get() if available
  if (typeof node.get === 'function') {
    try {
      return node.get(prefixed) || node.get(attr);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export default function roleMismatchWithLane() {
  // Collect lane mapping at the process level, then check individual tasks
  let elementToLane: Map<string, any> = new Map();

  function check(node: any, reporter: any) {
    // Build the lane map when we encounter a process
    if (isType(node, 'bpmn:Process')) {
      const laneSets = node.laneSets;
      if (laneSets && laneSets.length > 0) {
        elementToLane = buildElementToLaneMap(laneSets);
      }
      return;
    }

    // Only check user tasks
    if (!isType(node, 'bpmn:UserTask')) return;

    const lane = elementToLane.get(node.id);
    if (!lane || !lane.name) return;

    const assignee = getCamundaAttr(node, 'assignee');
    const candidateGroups = getCamundaAttr(node, 'candidateGroups');

    // Only check tasks that have explicit role assignments
    if (!assignee && !candidateGroups) return;

    const laneName = lane.name;
    let matches = false;

    if (assignee && fuzzyMatch(assignee, laneName)) {
      matches = true;
    }

    if (candidateGroups) {
      // candidateGroups can be comma-separated
      const groups = candidateGroups.split(',').map((g: string) => g.trim());
      for (const group of groups) {
        if (fuzzyMatch(group, laneName)) {
          matches = true;
          break;
        }
      }
    }

    if (!matches) {
      const taskName = node.name || node.id;
      const roleInfo = assignee ? `assignee="${assignee}"` : `candidateGroups="${candidateGroups}"`;
      reporter.report(
        node.id,
        `User task "${taskName}" has ${roleInfo} but is placed in lane "${laneName}". ` +
          'The role assignment does not match the lane name. Either move the task to the ' +
          'correct lane, or update the assignee/candidateGroups to match the lane role.'
      );
    }
  }

  return { check };
}
