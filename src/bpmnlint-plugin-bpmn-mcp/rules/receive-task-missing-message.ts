/**
 * Custom bpmnlint rule: receive-task-missing-message
 *
 * Warns when a bpmn:ReceiveTask has no messageRef.
 * Without a message reference, the Camunda 7 (Operaton) engine does not
 * know which message to listen for and the task will never complete
 * via message correlation.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:ReceiveTask')) return;

    if (!node.messageRef) {
      reporter.report(
        node.id,
        'Receive task has no message reference — ' +
          'the engine cannot correlate messages to this task. ' +
          'Use manage_bpmn_root_elements to create a message, then ' +
          'set_bpmn_element_properties to assign the messageRef'
      );
    }
  }

  return { check };
}

export default ruleFactory;
