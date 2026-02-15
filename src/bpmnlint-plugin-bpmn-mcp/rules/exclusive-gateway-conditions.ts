/**
 * Custom bpmnlint rule: exclusive-gateway-conditions
 *
 * Enforces that on an exclusive (or inclusive) split gateway, either:
 * - every outgoing flow has a condition expression, OR
 * - there is exactly one unconditional flow and it is set as the gateway's
 *   default flow.
 *
 * Without this, the Camunda 7 (Operaton) engine will throw at runtime when
 * it encounters a gateway with mixed conditional / unconditional flows and
 * no configured default.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:ExclusiveGateway') && !isType(node, 'bpmn:InclusiveGateway')) {
      return;
    }

    const outgoing: any[] = node.outgoing || [];
    // Only applies to split gateways (2+ outgoing flows)
    if (outgoing.length < 2) return;

    const flowsWithCondition = outgoing.filter((flow: any) => flow.conditionExpression);
    const flowsWithoutCondition = outgoing.filter((flow: any) => !flow.conditionExpression);
    const defaultFlow = node.default;

    // Case 1: No conditions at all — nothing to enforce here (gateway-missing-default handles this)
    if (flowsWithCondition.length === 0) return;

    // Case 2: All flows have conditions — OK
    if (flowsWithoutCondition.length === 0) return;

    // Case 3: Mixed — exactly one unconditional flow, must be the default
    if (flowsWithoutCondition.length === 1) {
      const unconditional = flowsWithoutCondition[0];
      if (!defaultFlow) {
        reporter.report(
          node.id,
          'Gateway has conditional and unconditional flows but no default flow configured — ' +
            'set the unconditional flow as the default'
        );
      } else if (defaultFlow.id !== unconditional.id) {
        reporter.report(
          node.id,
          'Gateway default flow has a condition expression — ' +
            'the default flow should be the unconditional one'
        );
      }
      return;
    }

    // Case 4: Multiple unconditional flows — at most one should lack a condition
    reporter.report(
      node.id,
      `Gateway has ${flowsWithoutCondition.length} outgoing flows without conditions — ` +
        'each outgoing flow must have a condition, or exactly one may be unconditional and set as default'
    );
  }

  return { check };
}

export default ruleFactory;
