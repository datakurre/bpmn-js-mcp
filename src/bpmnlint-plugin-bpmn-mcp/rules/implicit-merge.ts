/**
 * Custom bpmnlint rule: implicit-merge
 *
 * Detects activities (tasks, subprocesses, call activities) and end events
 * with multiple incoming sequence flows but no explicit merge gateway.
 * Best practice mandates using gateways for all flow merges — implicit
 * merges make the process harder to reason about and can cause
 * unexpected runtime behaviour (e.g. multiple activations).
 *
 * Note: Start events and gateways are excluded — gateways are designed
 * to merge flows, and start events cannot have incoming flows.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

function ruleFactory() {
  function check(node: any, reporter: any) {
    // Check activities (tasks, subprocesses, call activities) and end events
    if (
      !isType(node, 'bpmn:Task') &&
      !isType(node, 'bpmn:SubProcess') &&
      !isType(node, 'bpmn:CallActivity') &&
      !isType(node, 'bpmn:EndEvent')
    ) {
      return;
    }

    const incoming = node.incoming || [];
    if (incoming.length < 2) return;

    const elementKind = isType(node, 'bpmn:EndEvent') ? 'End event' : 'Activity';

    reporter.report(
      node.id,
      `${elementKind} has ${incoming.length} incoming flows — ` +
        `use an explicit merge gateway to combine flows`
    );
  }

  return { check };
}

export default ruleFactory;
