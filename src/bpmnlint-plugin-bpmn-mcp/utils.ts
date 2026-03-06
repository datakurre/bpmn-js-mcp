/**
 * Shared utilities for bpmnlint rules.
 *
 * Every custom rule needs to check BPMN element types via `$instanceOf`
 * (when available on the moddle object) or fall back to `$type` string
 * comparison.  This module extracts that common helper so individual
 * rule files stay focused on their domain logic.
 */

/** BPMN moddle node — the subset of properties used by lint rules. */
export interface BpmnNode {
  readonly $type: string;
  readonly $instanceOf?: (type: string) => boolean;
  [key: string]: any;
}

/** bpmnlint reporter callback. */
export type Reporter = (node: BpmnNode, message: string) => void;

/**
 * Check whether a BPMN moddle node matches a given type string.
 *
 * Prefers `$instanceOf` (respects moddle type hierarchy) and falls
 * back to an exact `$type` string comparison when the method is absent.
 */
export const isType = (node: BpmnNode, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;

// ── DI (Diagram Interchange) helpers ──────────────────────────────────────

export interface DiBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiPoint {
  x: number;
  y: number;
}

/** Walk up the parent chain to find the root bpmn:Definitions element. */
export function findDefinitions(node: any): any | null {
  let current = node;
  while (current) {
    if (current.$type === 'bpmn:Definitions') return current;
    current = current.$parent;
  }
  return null;
}

/**
 * Build maps from bpmnElement ID → DI bounds (for shapes) and
 * bpmnElement ID → waypoints (for edges), extracted from the diagram interchange.
 */
export function collectDI(definitions: any): {
  shapeBounds: Map<string, DiBounds>;
  edgeWaypoints: Map<string, DiPoint[]>;
} {
  const shapeBounds = new Map<string, DiBounds>();
  const edgeWaypoints = new Map<string, DiPoint[]>();

  const diagrams = definitions?.diagrams ?? [];
  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (el.$type === 'bpmndi:BPMNShape' && el.bpmnElement?.id && el.bounds) {
        shapeBounds.set(el.bpmnElement.id, {
          x: el.bounds.x,
          y: el.bounds.y,
          width: el.bounds.width,
          height: el.bounds.height,
        });
      } else if (el.$type === 'bpmndi:BPMNEdge' && el.bpmnElement?.id) {
        const wps: DiPoint[] = (el.waypoint ?? []).map((wp: any) => ({ x: wp.x, y: wp.y }));
        edgeWaypoints.set(el.bpmnElement.id, wps);
      }
    }
  }

  return { shapeBounds, edgeWaypoints };
}

/** Check if a point is within bounds expanded by the given tolerance. */
export function pointWithinBounds(p: DiPoint, b: DiBounds, tol: number): boolean {
  return (
    p.x >= b.x - tol &&
    p.x <= b.x + b.width + tol &&
    p.y >= b.y - tol &&
    p.y <= b.y + b.height + tol
  );
}
