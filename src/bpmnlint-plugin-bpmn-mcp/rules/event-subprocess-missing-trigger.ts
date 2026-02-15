/**
 * Custom bpmnlint rule: event-subprocess-missing-trigger
 *
 * Warns when an event subprocess has a start event without any event
 * definition (timer, message, error, signal, etc.).
 *
 * An event subprocess is activated by its start event's trigger. Without
 * an event definition, the start event is a "blank" start which is not
 * valid for event subprocesses — the engine has no trigger to activate it.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:SubProcess')) return;

    // Only check event subprocesses (triggeredByEvent = true)
    if (!node.triggeredByEvent) return;

    const flowElements = node.flowElements || [];

    // Find start events in the event subprocess
    const startEvents = flowElements.filter((el: any) => isType(el, 'bpmn:StartEvent'));

    for (const startEvent of startEvents) {
      const eventDefs = startEvent.eventDefinitions || [];
      if (eventDefs.length === 0) {
        reporter.report(
          startEvent.id,
          'Event subprocess start event has no event definition (timer, message, error, signal, etc.) — ' +
            'the event subprocess has no trigger and will never activate. ' +
            'Use set_bpmn_event_definition to add a trigger'
        );
      }
    }
  }

  return { check };
}

export default ruleFactory;
