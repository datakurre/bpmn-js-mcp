/**
 * Custom bpmnlint rule: gateway-missing-default
 *
 * Checks that exclusive/inclusive gateways with conditional outgoing flows
 * also have a default flow configured.  Without a default, the Camunda 7
 * (Operaton) engine throws an error at runtime if no condition matches.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:ExclusiveGateway') && !isType(node, 'bpmn:InclusiveGateway')) {
      return;
    }

    const outgoing = node.outgoing || [];
    if (outgoing.length < 2) return;

    const hasConditions = outgoing.some((flow: any) => flow.conditionExpression);
    const hasDefault = node.default != null;

    if (hasConditions && !hasDefault) {
      reporter.report(
        node.id,
        'Gateway has conditional flows but no default flow — engine will error if no condition matches'
      );
    }
  }
  return { check };
}

export default ruleFactory;
