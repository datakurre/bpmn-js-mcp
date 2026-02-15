/**
 * Custom bpmnlint rule: unpaired-link-event
 *
 * Warns when link intermediate events are not properly paired.
 * Link events must come in throw/catch pairs with matching names:
 * - An IntermediateThrowEvent with LinkEventDefinition "throws" to a link
 * - An IntermediateCatchEvent with LinkEventDefinition "catches" from a link
 *
 * This rule checks that:
 * 1. Every link throw event has a matching link catch event (same name)
 * 2. Every link catch event has a matching link throw event (same name)
 * 3. Link events have names (unnamed links cannot be matched)
 */

import { isType } from '../utils';

function getLinkEventDefinition(element: any): any | null {
  const eventDefs = element.eventDefinitions || [];
  return eventDefs.find((ed: any) => isType(ed, 'bpmn:LinkEventDefinition')) || null;
}

export default function unpairedLinkEvent() {
  function check(node: any, reporter: any) {
    // Check at process / subprocess level
    if (!isType(node, 'bpmn:Process') && !isType(node, 'bpmn:SubProcess')) return;

    const flowElements = node.flowElements || [];

    const linkThrows: Array<{ element: any; linkName: string }> = [];
    const linkCatches: Array<{ element: any; linkName: string }> = [];

    for (const el of flowElements) {
      const linkDef = getLinkEventDefinition(el);
      if (!linkDef) continue;

      const linkName = linkDef.name || el.name;

      if (!linkName) {
        reporter.report(
          el.id,
          'Link event has no name — link throw/catch pairs are matched by name. ' +
            'Set a name using set_bpmn_event_definition with properties: { name: "MyLink" }.'
        );
        continue;
      }

      if (isType(el, 'bpmn:IntermediateThrowEvent')) {
        linkThrows.push({ element: el, linkName });
      } else if (isType(el, 'bpmn:IntermediateCatchEvent')) {
        linkCatches.push({ element: el, linkName });
      }
    }

    // Check for unmatched throws
    const catchNames = new Set(linkCatches.map((c) => c.linkName));
    for (const { element, linkName } of linkThrows) {
      if (!catchNames.has(linkName)) {
        reporter.report(
          element.id,
          `Link throw event "${element.name || linkName}" has no matching catch event ` +
            `with link name "${linkName}". Add an IntermediateCatchEvent with a matching ` +
            `LinkEventDefinition name.`
        );
      }
    }

    // Check for unmatched catches
    const throwNames = new Set(linkThrows.map((t) => t.linkName));
    for (const { element, linkName } of linkCatches) {
      if (!throwNames.has(linkName)) {
        reporter.report(
          element.id,
          `Link catch event "${element.name || linkName}" has no matching throw event ` +
            `with link name "${linkName}". Add an IntermediateThrowEvent with a matching ` +
            `LinkEventDefinition name.`
        );
      }
    }
  }

  return { check };
}
