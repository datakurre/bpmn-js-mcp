/**
 * Custom bpmnlint rule: pool-size-insufficient
 *
 * Errors when a pool's bounds are smaller than the maximum extent of its
 * contained elements. This detects the root cause (undersized pool) rather
 * than the symptom (elements outside bounds).
 *
 * Complements `elements-outside-participant-bounds` which reports per-element,
 * while this rule reports once per pool with a resize recommendation.
 */

import { isType } from '../utils';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Minimum margin between element extent and pool edge (pixels). */
const MIN_MARGIN = 30;

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
 * Compute the bounding box of all flow elements in a process.
 */
function computeElementExtent(flowElements: any[], definitions: any): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const el of flowElements) {
    const b = findShapeBounds(el.id, definitions);
    if (!b) continue;
    found = true;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  if (!found) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export default function poolSizeInsufficient() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Participant')) return;

    const collaboration = node.$parent;
    const definitions = collaboration?.$parent;

    // Find participant bounds
    const poolBounds = findShapeBounds(node.id, definitions);
    if (!poolBounds) return;

    // Get the process attached to this participant
    const process = node.processRef;
    if (!process) return;

    const flowElements = process.flowElements || [];
    if (flowElements.length === 0) return;

    const extent = computeElementExtent(flowElements, definitions);
    if (!extent) return;

    // Check if pool is too small to contain all elements with margins
    const requiredWidth = extent.width + 2 * MIN_MARGIN;
    const requiredHeight = extent.height + 2 * MIN_MARGIN;

    // Also check absolute positioning: elements must fit within pool bounds
    const elementsOverflowRight = extent.x + extent.width > poolBounds.x + poolBounds.width + 2;
    const elementsOverflowBottom = extent.y + extent.height > poolBounds.y + poolBounds.height + 2;
    const elementsOverflowLeft = extent.x < poolBounds.x - 2;
    const elementsOverflowTop = extent.y < poolBounds.y - 2;

    const overflows =
      elementsOverflowRight ||
      elementsOverflowBottom ||
      elementsOverflowLeft ||
      elementsOverflowTop;
    const tooNarrow = poolBounds.width < requiredWidth;
    const tooShort = poolBounds.height < requiredHeight;

    if (!overflows && !tooNarrow && !tooShort) return;

    const issues: string[] = [];
    if (elementsOverflowRight || elementsOverflowLeft || tooNarrow) {
      const recommended = Math.ceil(requiredWidth + 60); // extra buffer for lane header
      issues.push(`width ${poolBounds.width}px is insufficient (recommended: ≥${recommended}px)`);
    }
    if (elementsOverflowTop || elementsOverflowBottom || tooShort) {
      const recommended = Math.ceil(requiredHeight);
      issues.push(`height ${poolBounds.height}px is insufficient (recommended: ≥${recommended}px)`);
    }

    const poolName = node.name || node.id;
    reporter.report(
      node.id,
      `Pool "${poolName}" is too small to contain its ${flowElements.length} elements: ` +
        `${issues.join('; ')}. ` +
        `Use move_bpmn_element with width/height to resize the pool, ` +
        `or run layout_bpmn_diagram to re-arrange all elements.`
    );
  }

  return { check };
}
