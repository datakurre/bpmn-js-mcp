/**
 * Custom bpmnlint rule: dangling-boundary-event
 *
 * Warns when a boundary event has no outgoing sequence flow.
 * A boundary event without outgoing flows will fire but the token
 * has nowhere to go — either connect it to a downstream element
 * or remove it.
 *
 * Exception: non-interrupting boundary events used purely for signaling
 * (e.g. a timer that only triggers an execution listener) may intentionally
 * have no outgoing flow, but this is uncommon and worth flagging.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:BoundaryEvent')) return;

    // Compensation boundary events don't use sequence flows — they use associations
    const eventDefs = node.eventDefinitions || [];
    const isCompensation = eventDefs.some((ed: any) =>
      isType(ed, 'bpmn:CompensateEventDefinition')
    );
    if (isCompensation) return;

    const outgoing = node.outgoing || [];
    if (outgoing.length === 0) {
      reporter.report(
        node.id,
        'Boundary event has no outgoing sequence flow — ' +
          'the event will fire but the token has nowhere to go. ' +
          'Connect it to a downstream element with connect_bpmn_elements'
      );
    }
  }

  return { check };
}

export default ruleFactory;
