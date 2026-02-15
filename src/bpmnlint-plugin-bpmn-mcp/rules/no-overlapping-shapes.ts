/**
 * Custom bpmnlint rule: no-overlapping-shapes
 *
 * Warns when two flow element shapes overlap in the diagram. Overlapping
 * shapes make the diagram unreadable and usually indicate a layout issue.
 *
 * Uses DI (diagram interchange) bounds from the BPMN XML rather than
 * runtime rendering data, avoiding false positives in headless mode.
 *
 * Ignores:
 * - Boundary events (they intentionally overlap their host)
 * - Lanes and participants (they are containers that overlap children)
 * - Associations, sequence flows, message flows (connections, not shapes)
 * - Label shapes (they can legitimately overlap connections)
 */

import { isType } from '../utils';

/** Bounds rectangle. */
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Minimum overlap area (in px²) to report. Avoids noise from 1px edge touches. */
const MIN_OVERLAP_AREA = 100;

/**
 * Check if two axis-aligned rectangles overlap significantly.
 */
function getOverlapArea(a: Bounds, b: Bounds): number {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlapX * overlapY;
}

/** Types to skip — containers, connections, and boundary events. */
const SKIP_TYPES = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Association',
  'bpmn:BoundaryEvent',
  'bpmn:Group',
]);

/** Shape entry with its bounds and element reference. */
interface ShapeEntry {
  id: string;
  elementId: string;
  bounds: Bounds;
  type: string;
}

/**
 * Determine whether a BPMNShape should be included in the overlap check.
 */
function isRelevantShape(el: any): boolean {
  if (!isType(el, 'bpmndi:BPMNShape')) return false;
  if (!el.bpmnElement || !el.bounds) return false;
  if (el.isLabel) return false;

  const bpmnType = el.bpmnElement.$type || '';
  return !SKIP_TYPES.has(bpmnType);
}

/**
 * Collect all relevant shapes from a BPMNPlane.
 */
function collectShapes(planeElements: any[]): ShapeEntry[] {
  const shapes: ShapeEntry[] = [];
  for (const el of planeElements) {
    if (!isRelevantShape(el)) continue;
    shapes.push({
      id: el.id,
      elementId: el.bpmnElement.id,
      bounds: {
        x: el.bounds.x,
        y: el.bounds.y,
        width: el.bounds.width,
        height: el.bounds.height,
      },
      type: el.bpmnElement.$type || '',
    });
  }
  return shapes;
}

/**
 * Report overlapping shape pairs.
 */
function reportOverlaps(shapes: ShapeEntry[], reporter: any): void {
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];
      const overlapArea = getOverlapArea(a.bounds, b.bounds);
      if (overlapArea < MIN_OVERLAP_AREA) continue;

      reporter.report(
        b.elementId,
        `Shape "${b.elementId}" overlaps with "${a.elementId}" ` +
          `(overlap area: ${Math.round(overlapArea)}px²). ` +
          `Use move_bpmn_element to reposition, or run layout_bpmn_diagram.`
      );
    }
  }
}

export default function noOverlappingShapes() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Definitions')) return;

    const diagrams = node.diagrams;
    if (!diagrams) return;

    for (const diagram of diagrams) {
      const plane = diagram?.plane;
      if (!plane?.planeElement) continue;

      const shapes = collectShapes(plane.planeElement);
      reportOverlaps(shapes, reporter);
    }
  }

  return { check };
}
