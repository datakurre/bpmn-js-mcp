/**
 * Custom bpmnlint rule: unaligned-message-events
 *
 * Suggests aligning send/receive event pairs (connected by message flows)
 * horizontally to reduce diagonal message flow lines. When throw and catch
 * message events in different pools are misaligned by more than a threshold,
 * this rule fires with a repositioning suggestion.
 *
 * Also checks task-to-task message flows for horizontal misalignment.
 */

import { isType } from '../utils';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Maximum X-offset between paired message flow endpoints before warning (pixels). */
const MAX_X_OFFSET = 50;

/**
 * Find the BPMNShape DI for a given element ID and return its bounds.
 */
function findShapeBounds(elementId: string, definitions: any): Bounds | null {
  const diagrams = definitions?.diagrams;
  if (!diagrams) return null;

  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNShape') && el.bpmnElement?.id === elementId) {
        const b = el.bounds;
        if (b) return { x: b.x, y: b.y, width: b.width, height: b.height };
      }
    }
  }
  return null;
}

/**
 * Get the center X coordinate of an element's shape.
 */
function getCenterX(elementId: string, definitions: any): number | null {
  const bounds = findShapeBounds(elementId, definitions);
  if (!bounds) return null;
  return bounds.x + bounds.width / 2;
}

export default function unalignedMessageEvents() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Collaboration')) return;

    const messageFlows = node.messageFlows || [];
    if (messageFlows.length === 0) return;

    const definitions = node.$parent;

    for (const mf of messageFlows) {
      const source = mf.sourceRef;
      const target = mf.targetRef;
      if (!source || !target) continue;

      // Skip if either end is a participant shape (collapsed pool)
      if (isType(source, 'bpmn:Participant') || isType(target, 'bpmn:Participant')) continue;

      const sourceCX = getCenterX(source.id, definitions);
      const targetCX = getCenterX(target.id, definitions);
      if (sourceCX === null || targetCX === null) continue;

      const offset = Math.abs(sourceCX - targetCX);
      if (offset <= MAX_X_OFFSET) continue;

      const sourceName = source.name || source.id;
      const targetName = target.name || target.id;

      reporter.report(
        mf.id,
        `Message flow endpoints "${sourceName}" and "${targetName}" are horizontally ` +
          `misaligned by ${Math.round(offset)}px (threshold: ${MAX_X_OFFSET}px). ` +
          `Align them vertically (same X coordinate) to create a straight vertical ` +
          `message flow and improve readability. Use move_bpmn_element to reposition ` +
          `one of the elements, or run layout_bpmn_diagram to re-arrange the diagram.`
      );
    }
  }

  return { check };
}
