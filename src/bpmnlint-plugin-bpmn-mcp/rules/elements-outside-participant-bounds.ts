/**
 * Custom bpmnlint rule: elements-outside-participant-bounds
 *
 * Warns when flow elements are positioned outside the bounds of their
 * parent participant (pool).  This indicates a layout issue — the
 * element may visually appear disconnected from its pool, or the pool
 * may need to be resized.
 *
 * Only checks expanded participants with DI (diagram interchange)
 * bounds information.  Collapsed participants and elements without
 * DI shapes are skipped.
 */

const isType = (node: any, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

/** Bounds rectangle { x, y, width, height }. */
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
 * Check if inner bounds are fully contained within outer bounds.
 * Uses a small tolerance to avoid false positives from floating-point rounding.
 */
function isWithinBounds(inner: Bounds, outer: Bounds, tolerance = 2): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

export default function elementsOutsideParticipantBounds() {
  function check(node: any, reporter: any) {
    if (!isType(node, 'bpmn:Participant')) return;

    // Skip collapsed participants
    const collaboration = node.$parent;
    const definitions = collaboration?.$parent;

    // Find participant bounds
    const poolBounds = findShapeBounds(node.id, definitions);
    if (!poolBounds) return;

    // Get the process attached to this participant
    const process = node.processRef;
    if (!process) return;

    const flowElements = process.flowElements || [];

    for (const el of flowElements) {
      const elBounds = findShapeBounds(el.id, definitions);
      if (!elBounds) continue;

      if (!isWithinBounds(elBounds, poolBounds)) {
        reporter.report(
          el.id,
          `Element "${el.name || el.id}" (${el.$type}) is positioned outside the bounds of ` +
            `its parent pool "${node.name || node.id}". ` +
            `Use move_bpmn_element to reposition it, or resize the pool.`
        );
      }
    }
  }

  return { check };
}
