/**
 * Custom bpmnlint rule: compensation-missing-association
 *
 * Checks that compensation boundary events are properly connected to their
 * compensation handler (an activity with `isForCompensation=true`) via a
 * `bpmn:Association`.  Without this association the compensation handler is
 * never invoked — the boundary event and the handler are just orphaned
 * elements.
 *
 * Also checks that intermediate compensation throw events have an
 * `activityRef` targeting a specific compensatable activity, unless
 * blanket compensation is intentional (all activities in scope have
 * compensation handlers).
 */

import { isType } from '../utils';

function hasCompensateEventDefinition(node: any): boolean {
  const eventDefs = node.eventDefinitions || [];
  return eventDefs.some((ed: any) => isType(ed, 'bpmn:CompensateEventDefinition'));
}

function ruleFactory() {
  function check(node: any, reporter: any) {
    // Check at process/subprocess level — where flowElements live
    if (!isType(node, 'bpmn:Process') && !isType(node, 'bpmn:SubProcess')) return;

    const flowElements = node.flowElements || [];
    const artifacts = node.artifacts || [];

    // Find compensation boundary events
    const compensationBoundaryEvents = flowElements.filter(
      (el: any) => isType(el, 'bpmn:BoundaryEvent') && hasCompensateEventDefinition(el)
    );

    // Find compensation handlers
    const compensationHandlers = flowElements.filter((el: any) => el.isForCompensation === true);

    // Find associations (can be in artifacts or flowElements depending on modeler)
    const allAssociations = [
      ...flowElements.filter((el: any) => isType(el, 'bpmn:Association')),
      ...artifacts.filter((el: any) => isType(el, 'bpmn:Association')),
    ];

    // Check each compensation boundary event has an association to a handler
    for (const boundaryEvent of compensationBoundaryEvents) {
      const hasAssociation = allAssociations.some(
        (assoc: any) =>
          (assoc.sourceRef?.id === boundaryEvent.id &&
            assoc.targetRef?.isForCompensation === true) ||
          (assoc.targetRef?.id === boundaryEvent.id && assoc.sourceRef?.isForCompensation === true)
      );

      if (!hasAssociation) {
        reporter.report(
          boundaryEvent.id,
          'Compensation boundary event has no association to a compensation handler — ' +
            'the handler will never be invoked. ' +
            'Connect it to an activity with isForCompensation=true via a bpmn:Association.'
        );
      }
    }

    // Find compensation throw events (intermediate or end)
    const compensationThrowEvents = flowElements.filter(
      (el: any) =>
        (isType(el, 'bpmn:IntermediateThrowEvent') || isType(el, 'bpmn:EndEvent')) &&
        hasCompensateEventDefinition(el)
    );

    // Check compensation throw events have activityRef when specific compensation is needed
    for (const throwEvent of compensationThrowEvents) {
      const compensateDef = (throwEvent.eventDefinitions || []).find((ed: any) =>
        isType(ed, 'bpmn:CompensateEventDefinition')
      );
      if (compensateDef && !compensateDef.activityRef) {
        // Blanket compensation — only valid if there are compensation handlers in scope
        if (compensationHandlers.length === 0 && compensationBoundaryEvents.length === 0) {
          reporter.report(
            throwEvent.id,
            'Compensation throw event has no activityRef and no compensation handlers exist in scope — ' +
              'compensation will have no effect. ' +
              'Either add an activityRef targeting a specific activity, or add compensation boundary events with handlers.'
          );
        }
      }
    }

    // Check each compensation handler is reachable from a compensation boundary event.
    // Without this link the engine cannot determine which activity the handler compensates,
    // so the compensation order is undefined.
    for (const handler of compensationHandlers) {
      const hasIncomingAssociation = allAssociations.some(
        (assoc: any) =>
          (assoc.targetRef?.id === handler.id &&
            compensationBoundaryEvents.some((be: any) => be.id === assoc.sourceRef?.id)) ||
          (assoc.sourceRef?.id === handler.id &&
            compensationBoundaryEvents.some((be: any) => be.id === assoc.targetRef?.id))
      );

      if (!hasIncomingAssociation) {
        reporter.report(
          handler.id,
          'Compensation handler is not connected to any compensation boundary event — ' +
            'attach a compensation boundary event to the service task this handler compensates, ' +
            'then connect it to this handler via a bpmn:Association to ensure correct compensation order.'
        );
      }
    }
  }

  return { check };
}

export default ruleFactory;
