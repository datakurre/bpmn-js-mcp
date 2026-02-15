/**
 * Custom bpmnlint rule: subprocess-expansion-issue
 *
 * Warns when an expanded subprocess is too narrow (<300px) or too short
 * (<180px) to comfortably contain its child elements. Collapsed subprocesses
 * are excluded from this check since they display as compact shapes.
 *
 * These minimum dimensions are based on practical experience: a subprocess
 * needs at least ~300×180px to hold a start event, one task, and an end event
 * with reasonable spacing.
 */

import { isType } from '../utils';

/** Minimum width for an expanded subprocess to be usable. */
const MIN_EXPANDED_WIDTH = 300;
/** Minimum height for an expanded subprocess to be usable. */
const MIN_EXPANDED_HEIGHT = 180;

/**
 * Check the BPMNShape DI to determine if a subprocess is expanded and get its bounds.
 */
function getShapeInfo(
  elementId: string,
  definitions: any
): { isExpanded: boolean; width: number; height: number } | undefined {
  const diagrams = definitions?.diagrams;
  if (!diagrams) return undefined;

  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNShape') && el.bpmnElement?.id === elementId) {
        const bounds = el.bounds;
        return {
          isExpanded: el.isExpanded !== false,
          width: bounds?.width ?? 0,
          height: bounds?.height ?? 0,
        };
      }
    }
  }
  return undefined;
}

export default function subprocessExpansionIssue() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:SubProcess')) return;

    // Find the root definitions to access DI
    let definitions = node.$parent;
    while (definitions && !isType(definitions, 'bpmn:Definitions')) {
      definitions = definitions.$parent;
    }
    if (!definitions) return;

    const shapeInfo = getShapeInfo(node.id, definitions);
    if (!shapeInfo) return;

    // Only check expanded subprocesses
    if (!shapeInfo.isExpanded) return;

    const issues: string[] = [];

    if (shapeInfo.width < MIN_EXPANDED_WIDTH) {
      issues.push(
        `width ${Math.round(shapeInfo.width)}px is below minimum ${MIN_EXPANDED_WIDTH}px`
      );
    }

    if (shapeInfo.height < MIN_EXPANDED_HEIGHT) {
      issues.push(
        `height ${Math.round(shapeInfo.height)}px is below minimum ${MIN_EXPANDED_HEIGHT}px`
      );
    }

    if (issues.length > 0) {
      const name = node.name || node.id;
      reporter.report(
        node.id,
        `Expanded subprocess "${name}" is too small: ${issues.join(', ')}. ` +
          `Minimum recommended size is ${MIN_EXPANDED_WIDTH}×${MIN_EXPANDED_HEIGHT}px. ` +
          'Use move_bpmn_element with width/height to resize, or run layout_bpmn_diagram ' +
          'to auto-arrange.'
      );
    }
  }

  return { check };
}
