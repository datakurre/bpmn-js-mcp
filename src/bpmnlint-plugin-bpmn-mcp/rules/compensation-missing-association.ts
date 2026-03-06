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

import { isType, findDefinitions, collectDI, pointWithinBounds } from '../utils';

/** Tolerance (px) for waypoint-within-bounds check on compensation associations. */
const DI_TOLERANCE = 20;

function hasCompensateEventDefinition(node: any): boolean {
  const eventDefs = node.eventDefinitions || [];
  return eventDefs.some((ed: any) => isType(ed, 'bpmn:CompensateEventDefinition'));
}

/**
 * Check whether the BPMNEdge for a given association is visible:
 * - at least 2 waypoints
 * - first waypoint within source DI bounds (± DI_TOLERANCE)
 * - last waypoint within target DI bounds (± DI_TOLERANCE)
 *
 * Returns `null` when no DI info is available (edge is assumed valid).
 * Returns a human-readable description of the problem when the edge appears invisible.
 */
function checkAssociationDI(assoc: any, defs: any): string | null {
  if (!defs) return null;
  const { shapeBounds, edgeWaypoints } = collectDI(defs);
  if (shapeBounds.size === 0 || edgeWaypoints.size === 0) return null;

  const wps = edgeWaypoints.get(assoc.id);
  if (!wps || wps.length < 2) {
    return `the association BPMNEdge has fewer than 2 waypoints — it will not be visible`;
  }

  const srcId = assoc.sourceRef?.id;
  const tgtId = assoc.targetRef?.id;
  if (!srcId || !tgtId) return null;

  const srcBounds = shapeBounds.get(srcId);
  const tgtBounds = shapeBounds.get(tgtId);
  if (!srcBounds || !tgtBounds) return null;

  const firstOk = pointWithinBounds(wps[0], srcBounds, DI_TOLERANCE);
  const lastOk = pointWithinBounds(wps[wps.length - 1], tgtBounds, DI_TOLERANCE);

  if (!firstOk || !lastOk) {
    const parts: string[] = [];
    if (!firstOk) {
      parts.push(
        `first waypoint (${wps[0].x},${wps[0].y}) is outside source bounds ` +
          `[${srcBounds.x},${srcBounds.y} ${srcBounds.width}×${srcBounds.height}]`
      );
    }
    if (!lastOk) {
      parts.push(
        `last waypoint (${wps[wps.length - 1].x},${wps[wps.length - 1].y}) is outside target bounds ` +
          `[${tgtBounds.x},${tgtBounds.y} ${tgtBounds.width}×${tgtBounds.height}]`
      );
    }
    return (
      `the association BPMNEdge has disconnected waypoints (${parts.join('; ')}) — ` +
      `the link is semantically valid but will be invisible. ` +
      `Run layout_bpmn_diagram to recompute waypoints, or use connect_bpmn_elements ` +
      `with explicit waypoints.`
    );
  }

  return null;
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

    // Fetch DI once per process/subprocess check (walk up to Definitions)
    const defs = findDefinitions(node);

    // Check each compensation boundary event has an association to a handler
    for (const boundaryEvent of compensationBoundaryEvents) {
      const connectingAssoc = allAssociations.find(
        (assoc: any) =>
          (assoc.sourceRef?.id === boundaryEvent.id &&
            assoc.targetRef?.isForCompensation === true) ||
          (assoc.targetRef?.id === boundaryEvent.id && assoc.sourceRef?.isForCompensation === true)
      );

      if (!connectingAssoc) {
        reporter.report(
          boundaryEvent.id,
          'Compensation boundary event has no association to a compensation handler — ' +
            'the handler will never be invoked. ' +
            'Connect it to an activity with isForCompensation=true via a bpmn:Association.'
        );
      } else {
        // Semantic association exists — also verify the BPMNEdge is visible in DI
        const diProblem = checkAssociationDI(connectingAssoc, defs);
        if (diProblem) {
          reporter.report(
            connectingAssoc.id,
            `Compensation boundary event is correctly wired to its handler, but ${diProblem}`
          );
        }
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
