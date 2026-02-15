/**
 * Custom bpmnlint rule: camunda-topic-without-external-type
 *
 * Checks that service tasks with camunda:topic also have camunda:type="external".
 * Without camunda:type="external", the Camunda 7 (Operaton) engine ignores the topic.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:ServiceTask')) return;

    const topic = node.topic || node.$attrs?.['camunda:topic'];
    const type = node.type || node.$attrs?.['camunda:type'];
    if (topic && type !== 'external') {
      reporter.report(node.id, `camunda:topic="${topic}" requires camunda:type="external"`);
    }
  }
  return { check };
}

export default ruleFactory;
