/**
 * Custom bpmnlint rule: inconsistent-lane-naming
 *
 * Reports an info-level hint when lane names don't follow common
 * role-based naming conventions. Good lane names represent roles,
 * departments, or actor types (e.g. "Manager", "HR Department",
 * "Customer Support", "Automated System").
 *
 * Detects:
 * - Lanes named after BPMN concepts (e.g. "Lane 1", "Swimlane")
 * - Lanes with technical/tool names (e.g. "bpmn:Lane", "UserTask lane")
 * - Unnamed lanes
 * - Inconsistent capitalisation across sibling lanes
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

/** Patterns that indicate a generic/placeholder lane name. */
const GENERIC_PATTERNS = [
  /^lane\s*\d*$/i,
  /^swimlane\s*\d*$/i,
  /^pool\s*\d*$/i,
  /^row\s*\d*$/i,
  /^band\s*\d*$/i,
  /^track\s*\d*$/i,
  /^default\s*lane/i,
  /^new\s*lane/i,
  /^untitled/i,
];

/** Patterns that indicate a BPMN-concept or tool-name leak. */
const TECHNICAL_PATTERNS = [
  /^bpmn:/i,
  /\blane\b.*\btask\b/i,
  /\bUserTask\b/,
  /\bServiceTask\b/,
  /\bScriptTask\b/,
  /\bSendTask\b/,
  /\bReceiveTask\b/,
  /\bManualTask\b/,
  /\bBusinessRuleTask\b/,
  /\bsubprocess\b/i,
  /\bgateway\b/i,
  /^mcp_/i,
];

function isCapitalised(name: string): boolean {
  const first = name.charAt(0);
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

/** Check if a name matches any pattern in a list. */
function matchesAny(name: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(name));
}

/** Report unnamed or poorly named lanes. */
function checkLaneName(lane: any, reporter: any): void {
  const name = lane.name;
  if (!name || name.trim() === '') {
    reporter.report(
      lane.id,
      'Lane has no name. Use a descriptive role-based name ' +
        '(e.g. "Manager", "Customer Support", "IT Department").'
    );
    return;
  }

  const trimmed = name.trim();

  if (matchesAny(trimmed, GENERIC_PATTERNS)) {
    reporter.report(
      lane.id,
      `Lane name "${trimmed}" appears to be a placeholder. Use a descriptive role-based name ` +
        `(e.g. "Manager", "Customer Support", "IT Department").`
    );
  }

  if (matchesAny(trimmed, TECHNICAL_PATTERNS)) {
    reporter.report(
      lane.id,
      `Lane name "${trimmed}" looks like a technical identifier. ` +
        `Lane names should represent roles or departments (e.g. "Approver", "Finance Team").`
    );
  }
}

/** Report inconsistent capitalisation across sibling lanes. */
function checkCapitalisationConsistency(lanes: any[], reporter: any): void {
  const named = lanes.filter((l) => l.name && l.name.trim() !== '');
  let capitalisedCount = 0;
  let uncapitalisedCount = 0;

  for (const lane of named) {
    if (isCapitalised(lane.name.trim())) capitalisedCount++;
    else uncapitalisedCount++;
  }

  if (capitalisedCount === 0 || uncapitalisedCount === 0) return;

  const isMinorityCapitalised = capitalisedCount < uncapitalisedCount;
  for (const lane of named) {
    const cap = isCapitalised(lane.name.trim());
    if (isMinorityCapitalised ? cap : !cap) {
      reporter.report(
        lane.id,
        `Lane name "${lane.name}" has inconsistent capitalisation compared to sibling lanes. ` +
          `Use consistent naming style across all lanes.`
      );
    }
  }
}

/** Collect all lanes from all lane sets. */
function collectLanes(laneSets: any[]): any[] {
  const result: any[] = [];
  for (const laneSet of laneSets) {
    for (const lane of laneSet.lanes || []) {
      result.push(lane);
    }
  }
  return result;
}

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Process')) return;

    const laneSets = node.laneSets;
    if (!laneSets || laneSets.length === 0) return;

    const allLanes = collectLanes(laneSets);
    if (allLanes.length < 2) return;

    for (const lane of allLanes) {
      checkLaneName(lane, reporter);
    }

    checkCapitalisationConsistency(allLanes, reporter);
  }

  return { check };
}

export default ruleFactory;
