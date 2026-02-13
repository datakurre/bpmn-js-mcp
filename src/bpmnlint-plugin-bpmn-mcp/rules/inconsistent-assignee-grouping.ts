/**
 * Custom bpmnlint rule: inconsistent-assignee-grouping
 *
 * Warns when elements with the same assignee or candidateGroups are
 * scattered across different lanes instead of being grouped together.
 * This helps identify process designs where role-based organization
 * could be improved.
 *
 * Only applies to processes with lanes. For flat processes without lanes,
 * the `lane-candidate-detection` rule is more appropriate.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

/**
 * Extract the primary role (assignee or first candidateGroup) from a node.
 */
function extractPrimaryRole(node: any): string | null {
  const assignee = node.$attrs?.['camunda:assignee'] ?? node.assignee;
  if (assignee) return `assignee:${assignee}`;

  const candidateGroups = node.$attrs?.['camunda:candidateGroups'] ?? node.candidateGroups;
  if (candidateGroups) {
    const first = String(candidateGroups).split(',')[0]?.trim();
    if (first) return `group:${first}`;
  }

  return null;
}

/**
 * Find which lane an element belongs to (first-wins deduplication).
 */
function findLaneForElement(elementId: string, laneSets: any[]): string | null {
  for (const laneSet of laneSets) {
    for (const lane of laneSet.lanes || []) {
      for (const ref of lane.flowNodeRef || []) {
        const refId = typeof ref === 'string' ? ref : ref.id;
        if (refId === elementId) return lane.name || lane.id;
      }
    }
  }
  return null;
}

/** Minimum number of elements with same role in different lanes to trigger warning. */
const MIN_SCATTERED = 2;

export default function inconsistentAssigneeGrouping() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Process')) return;

    // Only applies when lanes exist
    const laneSets = node.laneSets;
    if (!laneSets || laneSets.length === 0) return;

    const totalLanes = laneSets.reduce((sum: number, ls: any) => sum + (ls.lanes?.length || 0), 0);
    if (totalLanes < 2) return;

    const flowElements = node.flowElements || [];

    // Group elements by role → set of lanes they appear in
    const roleToLanes = new Map<string, Set<string>>();
    const roleToElements = new Map<string, string[]>();

    for (const el of flowElements) {
      if (!isType(el, 'bpmn:UserTask') && !isType(el, 'bpmn:ManualTask')) continue;

      const role = extractPrimaryRole(el);
      if (!role) continue;

      const lane = findLaneForElement(el.id, laneSets);
      if (!lane) continue;

      if (!roleToLanes.has(role)) {
        roleToLanes.set(role, new Set());
        roleToElements.set(role, []);
      }
      roleToLanes.get(role)!.add(lane);
      roleToElements.get(role)!.push(el.name || el.id);
    }

    // Report roles that span multiple lanes
    for (const [role, lanes] of roleToLanes) {
      if (lanes.size < MIN_SCATTERED) continue;

      const elements = roleToElements.get(role) || [];
      const [type, value] = role.split(':');
      const roleLabel = type === 'assignee' ? `assignee "${value}"` : `group "${value}"`;
      const laneNames = [...lanes].map((l) => `"${l}"`).join(', ');

      reporter.report(
        node.id,
        `Elements with ${roleLabel} are spread across ${lanes.size} lanes ` +
          `(${laneNames}): ${elements.join(', ')}. ` +
          `Consider grouping same-role elements in a single lane for clarity, ` +
          `or use assign_bpmn_elements_to_lane to reorganize.`
      );
    }
  }

  return { check };
}
