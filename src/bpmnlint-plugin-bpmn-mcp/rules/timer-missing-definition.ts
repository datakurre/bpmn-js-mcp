/**
 * Custom bpmnlint rule: timer-missing-definition
 *
 * Warns when a timer event (start, intermediate catch, or boundary) has a
 * bpmn:TimerEventDefinition but none of:
 *   - timeDuration (ISO 8601 duration, e.g. "PT15M")
 *   - timeDate (ISO 8601 date-time, e.g. "2025-12-31T23:59:00Z")
 *   - timeCycle (ISO 8601 repeating interval, e.g. "R3/PT10M")
 *
 * Without any of these, the timer has no trigger and will never fire.
 */

import { isType } from '../utils';

function ruleFactory() {
  function check(node: any, reporter: any) {
    // Only check events
    if (
      !isType(node, 'bpmn:StartEvent') &&
      !isType(node, 'bpmn:IntermediateCatchEvent') &&
      !isType(node, 'bpmn:BoundaryEvent')
    ) {
      return;
    }

    const eventDefs = node.eventDefinitions || [];
    for (const ed of eventDefs) {
      if (!isType(ed, 'bpmn:TimerEventDefinition')) continue;

      const hasDuration = ed.timeDuration?.body;
      const hasDate = ed.timeDate?.body;
      const hasCycle = ed.timeCycle?.body;

      if (!hasDuration && !hasDate && !hasCycle) {
        reporter.report(
          node.id,
          'Timer event has no timeDuration, timeDate, or timeCycle — ' +
            'the timer will never fire. ' +
            'Use set_bpmn_event_definition to configure the timer trigger'
        );
      }
    }
  }

  return { check };
}

export default ruleFactory;
