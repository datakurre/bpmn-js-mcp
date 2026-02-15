/**
 * Custom bpmnlint rule: empty-subprocess
 *
 * Warns when an expanded subprocess has no flow elements (tasks, events,
 * gateways, etc.) inside it. An empty expanded subprocess is likely a
 * modeling mistake — either add content or collapse/remove it.
 *
 * Collapsed subprocesses and event subprocesses (triggeredByEvent) are
 * excluded — collapsed subprocesses don't show content visually, and event
 * subprocesses may be intentionally minimal.
 */

import { isType } from '../utils';

/**
 * Check the BPMNShape DI to determine if a subprocess is expanded.
 */
function isExpanded(node: any): boolean {
  // Walk up to definitions for DI access
  let definitions = node.$parent;
  while (definitions && !isType(definitions, 'bpmn:Definitions')) {
    definitions = definitions.$parent;
  }
  if (!definitions?.diagrams) return true; // assume expanded if no DI

  for (const diagram of definitions.diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNShape') && el.bpmnElement?.id === node.id) {
        return el.isExpanded !== false;
      }
    }
  }
  return true; // assume expanded if shape not found
}

function ruleFactory() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:SubProcess')) return;

    // Skip event subprocesses
    if (node.triggeredByEvent) return;

    // Skip collapsed subprocesses
    if (!isExpanded(node)) return;

    const flowElements = node.flowElements || [];
    if (flowElements.length === 0) {
      reporter.report(
        node.id,
        'Expanded subprocess has no flow elements — ' +
          'add tasks/events inside it, collapse it, or remove it'
      );
    }
  }

  return { check };
}

export default ruleFactory;
