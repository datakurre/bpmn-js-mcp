/**
 * Custom bpmnlint rule: service-task-missing-implementation
 *
 * Warns when a bpmn:ServiceTask has no implementation configured.
 * A ServiceTask needs at least one of:
 *   - camunda:class (Java delegate)
 *   - camunda:delegateExpression (delegate expression)
 *   - camunda:expression (UEL expression)
 *   - camunda:type="external" with camunda:topic (external task)
 *
 * Without any implementation, the Camunda 7 (Operaton) engine will throw
 * an error at deployment or execution time.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:ServiceTask')) return;

    const cls = node.$attrs?.['camunda:class'] ?? node.class;
    const delegateExpr = node.$attrs?.['camunda:delegateExpression'] ?? node.delegateExpression;
    const expr = node.$attrs?.['camunda:expression'] ?? node.expression;
    const type = node.$attrs?.['camunda:type'] ?? node.type;
    const topic = node.$attrs?.['camunda:topic'] ?? node.topic;

    // camunda:type="external" requires a topic but counts as an implementation
    if (type === 'external' && topic) return;

    // Any of these counts as a valid implementation
    if (cls || delegateExpr || expr) return;

    // connector:connectorId is also a valid implementation
    const extensionElements = node.extensionElements?.values || [];
    for (const ext of extensionElements) {
      if (isType(ext, 'camunda:Connector') && ext.connectorId) return;
    }

    reporter.report(
      node.id,
      'Service task has no implementation — set camunda:class, ' +
        'camunda:delegateExpression, camunda:expression, or ' +
        'camunda:type="external" with camunda:topic'
    );
  }

  return { check };
}

export default ruleFactory;
