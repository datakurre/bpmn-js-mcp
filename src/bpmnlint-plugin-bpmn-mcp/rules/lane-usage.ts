/**
 * Custom bpmnlint rule: lane-usage
 *
 * Warns when lanes are used within a single pool. Best practice recommends
 * using collaboration diagrams (separate pools per role/system) instead of
 * lanes within a pool for better visual separation.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

function ruleFactory() {
  function check(node: any, reporter: any) {
    // Check at process level for lane sets
    if (!isType(node, 'bpmn:Process')) return;

    const laneSets = node.laneSets;
    if (!laneSets || laneSets.length === 0) return;

    for (const laneSet of laneSets) {
      const lanes = laneSet.lanes || [];
      if (lanes.length > 0) {
        reporter.report(
          node.id,
          `Process uses ${lanes.length} lane(s) — consider using a collaboration ` +
            `diagram with separate pools per role/system for better readability`
        );
      }
    }
  }

  return { check };
}

export default ruleFactory;
