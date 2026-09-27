/**
 * Shared layout assertion helpers for scenario-based layout tests.
 *
 * These assertions verify structural and geometric properties of a laid-out
 * BPMN diagram without depending on opaque fixture files.
 */

import { expect } from 'vitest';
import type { ElementRegistry } from '../../src/bpmn-types';

// ── Geometry helpers ────────────────────────────────────────────────────────

export function centreX(el: { x: number; width?: number }): number {
  return el.x + (el.width ?? 0) / 2;
}

export function centreY(el: { y: number; height?: number }): number {
  return el.y + (el.height ?? 0) / 2;
}

// ── Flow assertions ─────────────────────────────────────────────────────────

/**
 * Assert all sequence flows in the registry have strictly orthogonal waypoint
 * segments (each segment is either horizontal or vertical, not diagonal).
 */
export function assertOrthogonalFlows(registry: ElementRegistry): void {
  const flows = (registry as any).getAll().filter((el: any) => el.type === 'bpmn:SequenceFlow');

  for (const flow of flows) {
    const wps: Array<{ x: number; y: number }> = flow.waypoints ?? [];
    expect(wps.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < wps.length; i++) {
      const dx = Math.abs(wps[i].x - wps[i - 1].x);
      const dy = Math.abs(wps[i].y - wps[i - 1].y);
      expect(
        dx < 1 || dy < 1,
        `Flow ${flow.id} segment ${i - 1}→${i} is diagonal: ` +
          `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
      ).toBe(true);
    }
  }
}

// ── Position assertions ─────────────────────────────────────────────────────

/**
 * Assert that no two non-container shapes overlap.
 * Containers (pools, lanes, expanded subprocesses) are excluded.
 */
export function assertNoOverlaps(registry: ElementRegistry): void {
  const skipTypes = new Set([
    'bpmn:Participant',
    'bpmn:Lane',
    'bpmn:LaneSet',
    'bpmn:SequenceFlow',
    'bpmn:MessageFlow',
    'bpmn:Association',
    'label',
  ]);

  const shapes = (registry as any)
    .getAll()
    .filter((el: any) => !skipTypes.has(el.type) && typeof el.x === 'number');

  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];
      const overlapX = a.x < b.x + b.width && a.x + a.width > b.x;
      const overlapY = a.y < b.y + b.height && a.y + a.height > b.y;
      expect(
        !(overlapX && overlapY),
        `Elements ${a.id} and ${b.id} overlap: ` +
          `A=(${a.x},${a.y},${a.width}×${a.height}) B=(${b.x},${b.y},${b.width}×${b.height})`
      ).toBe(true);
    }
  }
}

/**
 * Assert that two or more elements are on distinct Y rows.
 * Each pair of center-Y values must differ by at least `minGap` pixels.
 */
export function assertDistinctRows(registry: ElementRegistry, ids: string[], minGap = 10): void {
  const ys = ids.map((id) => centreY((registry as any).get(id)));
  for (let i = 0; i < ys.length; i++) {
    for (let j = i + 1; j < ys.length; j++) {
      expect(
        Math.abs(ys[i] - ys[j]),
        `Elements ${ids[i]} and ${ids[j]} are too close vertically: ` +
          `Δy=${Math.abs(ys[i] - ys[j]).toFixed(1)}px (min ${minGap}px required)`
      ).toBeGreaterThan(minGap);
    }
  }
}

/**
 * Assert that a set of elements share approximately the same Y row.
 * All center-Y values must be within `tolerance` pixels of the first element.
 */
export function assertSameRow(registry: ElementRegistry, ids: string[], tolerance = 5): void {
  const ys = ids.map((id) => centreY((registry as any).get(id)));
  const refY = ys[0];
  for (let i = 1; i < ys.length; i++) {
    expect(
      Math.abs(ys[i] - refY),
      `Element ${ids[i]} center-Y=${ys[i].toFixed(1)} deviates from ` +
        `${ids[0]} center-Y=${refY.toFixed(1)} by more than ${tolerance}px`
    ).toBeLessThanOrEqual(tolerance);
  }
}

/**
 * Assert that elements are ordered strictly left-to-right
 * (center-X of each element is greater than the previous one).
 */
export function assertLeftToRight(registry: ElementRegistry, ids: string[]): void {
  const xs = ids.map((id) => centreX((registry as any).get(id)));
  for (let i = 1; i < xs.length; i++) {
    expect(
      xs[i],
      `Element ${ids[i]} (x=${xs[i].toFixed(1)}) is not to the right of ` +
        `${ids[i - 1]} (x=${xs[i - 1].toFixed(1)})`
    ).toBeGreaterThan(xs[i - 1]);
  }
}

/**
 * Assert that an element is inside its assigned lane's Y bounds.
 */
export function assertInLane(registry: ElementRegistry, elementId: string, laneId: string): void {
  const el = (registry as any).get(elementId);
  const lane = (registry as any).get(laneId);
  expect(el, `Element ${elementId} not found in registry`).toBeTruthy();
  expect(lane, `Lane ${laneId} not found in registry`).toBeTruthy();

  const elTop = el.y;
  const elBottom = el.y + el.height;
  const laneTop = lane.y;
  const laneBottom = lane.y + lane.height;

  expect(
    elTop >= laneTop - 1 && elBottom <= laneBottom + 1,
    `Element ${elementId} (y=${elTop}..${elBottom}) is outside lane ` +
      `${laneId} (y=${laneTop}..${laneBottom})`
  ).toBe(true);
}

/**
 * Assert that all child elements are within the parent container's bounds.
 */
export function assertContainedIn(
  registry: ElementRegistry,
  childIds: string[],
  parentId: string
): void {
  const parent = (registry as any).get(parentId);
  expect(parent, `Parent ${parentId} not found`).toBeTruthy();

  for (const childId of childIds) {
    const child = (registry as any).get(childId);
    expect(child, `Child ${childId} not found`).toBeTruthy();

    const childRight = child.x + child.width;
    const childBottom = child.y + child.height;
    const parentRight = parent.x + parent.width;
    const parentBottom = parent.y + parent.height;

    expect(
      child.x >= parent.x - 1 &&
        child.y >= parent.y - 1 &&
        childRight <= parentRight + 1 &&
        childBottom <= parentBottom + 1,
      `Element ${childId} (${child.x},${child.y},${child.width}×${child.height}) ` +
        `is outside parent ${parentId} (${parent.x},${parent.y},${parent.width}×${parent.height})`
    ).toBe(true);
  }
}

/**
 * Assert that all sequence flows connect elements left-to-right
 * (target center-X > source center-X).
 *
 * Use in diagrams without loop-back edges. Back-edge connections
 * where target is intentionally to the left of source will fail this check,
 * so pass them in `excludeFlowIds` to skip them.
 *
 * This catches open-fan gateway backward connections where the layout
 * algorithm places downstream elements at the same X-layer as
 * sibling-branch elements, causing U-turn routes.
 */
export function assertAllFlowsForward(
  registry: ElementRegistry,
  tolerance = 1,
  excludeFlowIds?: Set<string>
): void {
  const flows = (registry as any).getAll().filter((el: any) => el.type === 'bpmn:SequenceFlow');

  for (const flow of flows) {
    if (excludeFlowIds?.has(flow.id)) continue;
    const source = flow.source;
    const target = flow.target;
    if (!source || !target) continue;

    const sourceCenterX = source.x + (source.width ?? 0) / 2;
    const targetCenterX = target.x + (target.width ?? 0) / 2;

    expect(
      targetCenterX,
      `Flow ${flow.id} goes backward: ` +
        `source ${source.id} (${source.type}, center-x=${sourceCenterX.toFixed(1)}) → ` +
        `target ${target.id} (${target.type}, center-x=${targetCenterX.toFixed(1)})`
    ).toBeGreaterThan(sourceCenterX - tolerance);
  }
}

/**
 * Assert that every flow node in the registry has a non-zero size (DI is present).
 * Pools and lanes are included. Connections and labels are excluded.
 */
export function assertAllElementsHaveShape(registry: ElementRegistry): void {
  const skipTypes = new Set([
    'bpmn:SequenceFlow',
    'bpmn:MessageFlow',
    'bpmn:Association',
    'bpmn:DataInputAssociation',
    'bpmn:DataOutputAssociation',
    'label',
  ]);

  const shapes = (registry as any)
    .getAll()
    .filter((el: any) => !skipTypes.has(el.type) && typeof el.x === 'number');

  for (const shape of shapes) {
    expect(
      shape.width > 0 && shape.height > 0,
      `Element ${shape.id} (${shape.type}) has no valid DI shape: ` +
        `width=${shape.width}, height=${shape.height}`
    ).toBe(true);
  }
}
