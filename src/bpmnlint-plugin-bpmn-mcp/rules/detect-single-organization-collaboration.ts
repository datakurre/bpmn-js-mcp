/**
 * Custom bpmnlint rule: detect-single-organization-collaboration
 *
 * Flags collaborations where all participants share the same
 * `camunda:candidateGroups` namespace pattern, suggesting they belong
 * to the same organization and should use lanes instead of separate pools.
 *
 * Heuristics:
 * 1. Multiple expanded pools exist in the collaboration
 * 2. Tasks across all pools use `camunda:candidateGroups` values that share
 *    a common namespace prefix (e.g. "org.acme.support", "org.acme.sales")
 *    or are simply all from the same flat namespace
 * 3. If all groups share a common prefix or all pools have groups defined,
 *    this suggests a single-organization scenario better modeled with lanes
 *
 * This complements `prefer-lanes-over-pools` (which checks structural patterns)
 * with semantic analysis of role assignments.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

/**
 * Check the BPMNShape DI to determine if a participant is expanded.
 */
function isExpanded(participantId: string, definitions: any): boolean {
  const diagrams = definitions?.diagrams;
  if (!diagrams) return true;

  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNShape') && el.bpmnElement?.id === participantId) {
        return el.isExpanded !== false;
      }
    }
  }
  return true;
}

/**
 * Extract all candidateGroups values from a process's flow elements.
 */
function extractCandidateGroups(process: any): Set<string> {
  const groups = new Set<string>();
  const flowElements = process?.flowElements || [];
  for (const el of flowElements) {
    if (!isType(el, 'bpmn:UserTask') && !isType(el, 'bpmn:ManualTask')) continue;
    const cg = el.$attrs?.['camunda:candidateGroups'] ?? el.candidateGroups;
    if (cg) {
      for (const group of String(cg).split(',')) {
        const trimmed = group.trim();
        if (trimmed) groups.add(trimmed);
      }
    }
  }
  return groups;
}

/**
 * Find the longest common prefix among a set of strings.
 * Returns empty string if no common prefix of length ≥ 2 exists.
 */
function findCommonPrefix(values: string[]): string {
  if (values.length < 2) return '';
  const sorted = [...values].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let i = 0;
  while (i < first.length && i < last.length && first[i] === last[i]) {
    i++;
  }
  return first.slice(0, i);
}

/** Minimum number of expanded pools with candidateGroups to trigger the rule. */
const MIN_POOLS_WITH_GROUPS = 2;

export default function detectSingleOrganizationCollaboration() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Collaboration')) return;

    const participants = node.participants || [];
    if (participants.length < 2) return;

    const definitions = node.$parent;

    // Only consider expanded pools with processes
    const expandedWithProcess = participants.filter(
      (p: any) => isExpanded(p.id, definitions) && p.processRef
    );

    if (expandedWithProcess.length < 2) return;

    // Collect candidateGroups per pool
    const poolGroups: Array<{ name: string; groups: Set<string> }> = [];
    const allGroups: string[] = [];

    for (const participant of expandedWithProcess) {
      const groups = extractCandidateGroups(participant.processRef);
      if (groups.size > 0) {
        poolGroups.push({
          name: participant.name || participant.id,
          groups,
        });
        for (const g of groups) allGroups.push(g);
      }
    }

    // Need at least MIN_POOLS_WITH_GROUPS pools with candidateGroups
    if (poolGroups.length < MIN_POOLS_WITH_GROUPS) return;

    // Check for shared namespace pattern
    const commonPrefix = findCommonPrefix(allGroups);
    // A meaningful prefix should contain at least a dot-separated segment or 3+ chars
    const hasMeaningfulPrefix = commonPrefix.length >= 3 || commonPrefix.includes('.');

    // Alternative: all pools have groups defined → suggests same org
    const allPoolsHaveGroups = poolGroups.length === expandedWithProcess.length;

    if (!hasMeaningfulPrefix && !allPoolsHaveGroups) return;

    const poolNames = poolGroups.map((p) => `"${p.name}"`).join(', ');
    const groupNames = [...new Set(allGroups)].map((g) => `"${g}"`).join(', ');

    let reason: string;
    if (hasMeaningfulPrefix) {
      reason = `share a common namespace prefix "${commonPrefix}" in candidateGroups (${groupNames})`;
    } else {
      reason = `all define candidateGroups (${groupNames})`;
    }

    reporter.report(
      node.id,
      `Pools ${poolNames} ${reason}, suggesting they belong to the same organization. ` +
        'Consider using lanes within a single pool instead of separate pools. ' +
        'Lanes model role separation within one process; pools model separate organizations. ' +
        'Use convert_bpmn_collaboration_to_lanes to convert, or suggest_bpmn_pool_vs_lanes to analyze first.'
    );
  }

  return { check };
}
