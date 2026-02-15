/**
 * Custom bpmnlint rule: gateway-pair-mismatch
 *
 * Detects split gateways (1 incoming, 2+ outgoing) without a corresponding
 * join gateway of the same type downstream. Paired split/join is a core
 * best practice for readable BPMN diagrams.
 */

import { isType } from '../utils';

const GATEWAY_TYPES = ['bpmn:ExclusiveGateway', 'bpmn:ParallelGateway', 'bpmn:InclusiveGateway'];

function ruleFactory() {
  function check(node: any, reporter: any) {
    // Only check process/subprocess level (where flowElements live)
    if (!isType(node, 'bpmn:Process') && !isType(node, 'bpmn:SubProcess')) return;

    const flowElements = node.flowElements || [];
    const gateways = flowElements.filter((el: any) => GATEWAY_TYPES.some((t) => isType(el, t)));

    // Identify splits (1 incoming, 2+ outgoing) and joins (2+ incoming, 1 outgoing)
    const splits = gateways.filter(
      (gw: any) => (gw.incoming?.length || 0) <= 1 && (gw.outgoing?.length || 0) >= 2
    );
    const joins = gateways.filter(
      (gw: any) => (gw.incoming?.length || 0) >= 2 && (gw.outgoing?.length || 0) <= 1
    );

    for (const split of splits) {
      const splitType = split.$type;
      // Check if there's a matching join of the same type
      const hasMatchingJoin = joins.some((join: any) => join.$type === splitType);
      if (!hasMatchingJoin) {
        reporter.report(
          split.id,
          `Split ${splitType.replace('bpmn:', '')} has no matching join gateway of the same type — ` +
            `pair split/join gateways for readability`
        );
      }
    }
  }

  return { check };
}

export default ruleFactory;
