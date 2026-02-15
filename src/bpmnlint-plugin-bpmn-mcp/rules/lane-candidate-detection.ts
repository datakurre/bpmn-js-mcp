/**
 * Custom bpmnlint rule: lane-candidate-detection
 *
 * Suggests lane creation when multiple distinct `camunda:assignee` or
 * `camunda:candidateGroups` values appear in a flat process (no lanes).
 *
 * This is a more specific variant of `lanes-expected-but-missing`: instead of
 * just counting user/manual tasks, this rule checks for distinct role
 * assignments. If 2+ different assignees/candidateGroups exist without lanes,
 * the modeler should consider organizing elements into lanes by role.
 */

import { isType } from '../utils';

/** Minimum distinct roles before suggesting lanes. */
const MIN_DISTINCT_ROLES = 2;

/**
 * Extract the assignee/candidateGroups from a flow node.
 * Returns a set of role identifiers found on the element.
 */
function extractRoles(node: any): Set<string> {
  const roles = new Set<string>();

  const assignee = node.$attrs?.['camunda:assignee'] ?? node.assignee;
  if (assignee) roles.add(`assignee:${assignee}`);

  const candidateGroups = node.$attrs?.['camunda:candidateGroups'] ?? node.candidateGroups;
  if (candidateGroups) {
    // candidateGroups can be comma-separated
    for (const group of String(candidateGroups).split(',')) {
      const trimmed = group.trim();
      if (trimmed) roles.add(`group:${trimmed}`);
    }
  }

  return roles;
}

export default function laneCandidateDetection() {
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

    const flowElements = node.flowElements || [];

    // Collect all distinct roles across flow elements
    const allRoles = new Set<string>();
    const elementsWithRoles: Array<{ name: string; roles: Set<string> }> = [];

    for (const el of flowElements) {
      if (!isType(el, 'bpmn:UserTask') && !isType(el, 'bpmn:ManualTask')) continue;
      const roles = extractRoles(el);
      if (roles.size > 0) {
        for (const r of roles) allRoles.add(r);
        elementsWithRoles.push({ name: el.name || el.id, roles });
      }
    }

    if (allRoles.size < MIN_DISTINCT_ROLES) return;

    // Format the distinct roles for the message
    const roleNames = [...allRoles]
      .map((r) => {
        const [type, value] = r.split(':');
        return type === 'assignee' ? `assignee "${value}"` : `group "${value}"`;
      })
      .join(', ');

    reporter.report(
      node.id,
      `Process has ${allRoles.size} distinct role assignments (${roleNames}) ` +
        `across ${elementsWithRoles.length} tasks but no lanes. ` +
        `Consider using create_bpmn_lanes to organize elements by role.`
    );
  }

  return { check };
}
