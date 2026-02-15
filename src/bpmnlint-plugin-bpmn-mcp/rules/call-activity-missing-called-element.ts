/**
 * Custom bpmnlint rule: call-activity-missing-called-element
 *
 * Warns when a bpmn:CallActivity has no calledElement attribute.
 * Without calledElement, the Camunda 7 (Operaton) engine does not know
 * which process definition to invoke and will throw an error.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:CallActivity')) return;

    const calledElement = node.calledElement ?? node.$attrs?.['camunda:calledElement'];

    // Also check for CMMN case reference (less common)
    const caseRef = node.$attrs?.['camunda:caseRef'];

    if (!calledElement && !caseRef) {
      reporter.report(
        node.id,
        'Call activity has no calledElement — the engine will not know ' +
          'which process to invoke. ' +
          'Use set_bpmn_element_properties to set calledElement'
      );
    }
  }

  return { check };
}

export default ruleFactory;
