/**
 * Custom bpmnlint rule: parallel-gateway-merge-exclusive
 *
 * Warns when a parallel gateway appears to be used to merge (join) flows
 * that originate from an exclusive gateway split.
 *
 * An exclusive gateway means only ONE branch is taken at runtime.
 * A parallel join waits for ALL incoming flows — so it would deadlock
 * (or never complete) because the untaken branches never produce tokens.
 *
 * The correct pattern is to merge exclusive branches with an exclusive
 * gateway, not a parallel one.
 */

import { isType } from '../utils';

const GATEWAY_TYPES = [
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
];

function isGateway(node: any): boolean {
  return GATEWAY_TYPES.some((t) => isType(node, t));
}

/**
 * Walk backward from a node through its incoming sequence flows until
 * we find a gateway. Returns the first gateway encountered on each path,
 * or null if the path terminates without hitting one.
 * Uses a visited set to avoid infinite loops in cyclic graphs.
 */
function findFirstGatewayBackward(node: any, visited: Set<string>): any | null {
  if (!node || visited.has(node.id)) return null;
  visited.add(node.id);

  if (isGateway(node)) return node;

  const incoming: any[] = node.incoming || [];
  for (const flow of incoming) {
    const source = flow.sourceRef;
    if (source) {
      const gw = findFirstGatewayBackward(source, visited);
      if (gw) return gw;
    }
  }
  return null;
}

function ruleFactory() {
  function check(node: any, reporter: any) {
    // Only check at process/subprocess level
    if (!isType(node, 'bpmn:Process') && !isType(node, 'bpmn:SubProcess')) return;

    const flowElements = node.flowElements || [];

    // Find parallel join gateways (2+ incoming, ≤1 outgoing)
    const parallelJoins = flowElements.filter(
      (el: any) =>
        isType(el, 'bpmn:ParallelGateway') &&
        (el.incoming?.length || 0) >= 2 &&
        (el.outgoing?.length || 0) <= 1
    );

    for (const join of parallelJoins) {
      const incoming: any[] = join.incoming || [];

      // For each incoming flow, trace backward to find the first gateway
      const sourceGateways: any[] = [];
      for (const flow of incoming) {
        const source = flow.sourceRef;
        if (!source) continue;
        const gw = findFirstGatewayBackward(source, new Set([join.id]));
        if (gw) sourceGateways.push(gw);
      }

      // If all incoming paths trace back to the same exclusive gateway, warn
      if (sourceGateways.length >= 2) {
        const uniqueIds = new Set(sourceGateways.map((gw: any) => gw.id));
        if (uniqueIds.size === 1) {
          const splitGw = sourceGateways[0];
          if (isType(splitGw, 'bpmn:ExclusiveGateway')) {
            reporter.report(
              join.id,
              'Parallel gateway is merging flows from an exclusive gateway split — ' +
                'only one branch is taken at runtime, so the parallel join will deadlock. ' +
                'Use an exclusive gateway to merge exclusive branches.'
            );
          }
        }
      }
    }
  }

  return { check };
}

export default ruleFactory;
