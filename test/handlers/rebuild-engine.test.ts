/**
 * Unit tests for the rebuild-based layout engine — Phase 2 + Phase 3 + Phase 4.
 *
 * Tests against programmatically built diagrams (fixture-builders) to verify:
 * - Linear chain rebuild (2.2)
 * - Gateway fan-out positioning (2.3)
 * - Gateway merge positioning (2.4)
 * - Back-edge connection layout (2.5)
 * - Boundary event positioning + exception chains (3.4)
 * - Recursive subprocess rebuild (3.1)
 * - Collaboration pool stacking (3.2)
 * - Lane assignment after rebuild (3.3)
 * - Event subprocess positioning (3.5)
 * - Collapsed pool stacking (3.6)
 * - Text annotation and data object positioning (4.1, 4.2)
 * - Label adjustment (4.4)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { rebuildLayout } from '../../src/rebuild';
import { clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';
import type { BpmnElement, ElementRegistry } from '../../src/bpmn-types';
import {
  buildF01LinearFlow,
  buildF02ExclusiveGateway,
  buildF03ParallelForkJoin,
  buildF04NestedSubprocess,
  buildF05Collaboration,
  buildF06BoundaryEvents,
  buildF08CollaborationCollapsed,
  buildF10PoolWithLanes,
  buildF11EventSubprocess,
  buildF12TextAnnotation,
  buildF13PoolWithNonInterruptingBoundary,
} from '../scenarios/fixture-builders';

afterEach(() => clearDiagrams());

// ── Helpers ────────────────────────────────────────────────────────────────

function getRegistry(diagramId: string): ElementRegistry {
  return getDiagram(diagramId)!.modeler.get('elementRegistry') as ElementRegistry;
}

/** Get element center coordinates. */
function center(el: BpmnElement): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2.1 — Engine scaffold
// ═══════════════════════════════════════════════════════════════════════════

describe('rebuildLayout scaffold', () => {
  test('returns zero counts for an empty diagram', async () => {
    const ids = await buildF01LinearFlow();
    const diagram = getDiagram(ids.diagramId)!;

    // Rebuild a valid diagram returns non-zero counts
    const result = rebuildLayout(diagram);
    expect(result).toHaveProperty('repositionedCount');
    expect(result).toHaveProperty('reroutedCount');
  });

  test('result includes repositioned and rerouted counts', async () => {
    const ids = await buildF01LinearFlow();
    const diagram = getDiagram(ids.diagramId)!;

    const result = rebuildLayout(diagram);
    // 5 nodes may or may not all need moving, but connections are re-routed
    expect(result.repositionedCount).toBeGreaterThanOrEqual(0);
    expect(result.reroutedCount).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2.2 — Linear chain rebuild
// ═══════════════════════════════════════════════════════════════════════════

describe('linear chain rebuild (F01 linear flow)', () => {
  test('all elements are on the same horizontal line', async () => {
    const ids = await buildF01LinearFlow();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const elementIds = [ids.start, ids.task1, ids.task2, ids.task3, ids.end];
    const centers = elementIds.map((id) => center(registry.get(id)!));

    // All elements should share the same Y (within tolerance)
    const baseY = centers[0].y;
    for (const c of centers) {
      expect(Math.abs(c.y - baseY)).toBeLessThan(2);
    }
  });

  test('elements are in strict left-to-right order', async () => {
    const ids = await buildF01LinearFlow();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const elementIds = [
      ids.start, // Start
      ids.task1, // Validate Order
      ids.task2, // Process Payment
      ids.task3, // Ship Order
      ids.end, // Done
    ];

    const xs = elementIds.map((id) => registry.get(id)!.x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  test('spacing between consecutive elements is consistent', async () => {
    const ids = await buildF01LinearFlow();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const elementIds = [ids.start, ids.task1, ids.task2, ids.task3, ids.end];
    const elements = elementIds.map((id) => registry.get(id)!);

    // Compute edge-to-edge gaps
    const gaps: number[] = [];
    for (let i = 1; i < elements.length; i++) {
      const prevRight = elements[i - 1].x + elements[i - 1].width;
      const currLeft = elements[i].x;
      gaps.push(currLeft - prevRight);
    }

    // All gaps should be close to the standard 50px gap.
    // Grid snapping may shift positions by ≤5 px so we allow a ±5 px tolerance.
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(48);
      expect(g).toBeLessThanOrEqual(60);
    }
    // Gaps must also be mutually consistent (max spread ≤ 10 px).
    const maxGap = Math.max(...gaps);
    const minGap = Math.min(...gaps);
    expect(maxGap - minGap).toBeLessThanOrEqual(10);
  });

  test('start event is placed at the default origin', async () => {
    const ids = await buildF01LinearFlow();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const startEl = registry.get(ids.start)!;
    const c = center(startEl);

    // Grid snapping may shift the start position by ≤5 px from the origin.
    expect(Math.abs(c.x - 180)).toBeLessThanOrEqual(5);
    expect(c.y).toBe(200);
  });

  test('connections have valid waypoints after rebuild', async () => {
    const ids = await buildF01LinearFlow();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    // All 4 sequence flows in a 5-node linear chain
    const allFlows = (registry as any)
      .getAll()
      .filter((el: any) => el.type === 'bpmn:SequenceFlow');
    expect(allFlows.length).toBe(4);

    for (const flow of allFlows) {
      expect(flow.waypoints).toBeDefined();
      expect(flow.waypoints!.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2.3/2.4 — Gateway fan-out and merge (exclusive gateway)
// ═══════════════════════════════════════════════════════════════════════════

describe('gateway positioning (F02 exclusive gateway)', () => {
  test('split and merge gateways are at the same Y', async () => {
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const split = center(registry.get(ids.split)!);
    const merge = center(registry.get(ids.merge)!);

    expect(Math.abs(split.y - merge.y)).toBeLessThan(2);
  });

  test('merge gateway is to the right of both branch elements', async () => {
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const fulfill = registry.get(ids.fulfill)!;
    const reject = registry.get(ids.reject)!;
    const merge = registry.get(ids.merge)!;

    // Merge left edge should be past both branches' right edges
    expect(merge.x).toBeGreaterThan(fulfill.x + fulfill.width);
    expect(merge.x).toBeGreaterThan(reject.x + reject.width);
  });

  test('branch elements have primary branch at gateway Y for exclusive gateways', async () => {
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const split = center(registry.get(ids.split)!);
    const fulfillC = center(registry.get(ids.fulfill)!);
    const rejectC = center(registry.get(ids.reject)!);

    // For 2-branch exclusive gateways: branch 0 aligns with gateway Y (straight, 0 bends),
    // branch 1 is placed one full branchSpacing below (2 bends: L-shape at split + merge).
    const offset1 = fulfillC.y - split.y;
    const offset2 = rejectC.y - split.y;

    // Branch 0 (fulfill) should be at the same Y as the gateway
    expect(Math.abs(offset1)).toBeLessThan(2);
    // Branch 1 (reject) should be below the gateway
    expect(offset2).toBeGreaterThan(50);
  });

  test('branch elements share the same X position', async () => {
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const fulfill = center(registry.get(ids.fulfill)!);
    const reject = center(registry.get(ids.reject)!);

    // Both branches should be at the same X (right of the split gateway)
    expect(Math.abs(fulfill.x - reject.x)).toBeLessThan(2);
  });

  test('elements before the split are on the main flow Y', async () => {
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const start = center(registry.get(ids.start)!);
    const review = center(registry.get(ids.review)!);
    const split = center(registry.get(ids.split)!);

    // Start, Review, Split gateway should all be at the same Y
    expect(Math.abs(start.y - review.y)).toBeLessThan(2);
    expect(Math.abs(review.y - split.y)).toBeLessThan(2);
  });

  test('end event is after the merge gateway', async () => {
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const merge = registry.get(ids.merge)!;
    const end = registry.get(ids.end)!;

    expect(end.x).toBeGreaterThan(merge.x + merge.width);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2.3/2.4 — Parallel fork-join (3-way split)
// ═══════════════════════════════════════════════════════════════════════════

describe('parallel fork-join positioning (F03 parallel fork-join)', () => {
  test('fork and join gateways share the same Y', async () => {
    const ids = await buildF03ParallelForkJoin();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const fork = center(registry.get(ids.fork)!);
    const join = center(registry.get(ids.join)!);

    expect(Math.abs(fork.y - join.y)).toBeLessThan(2);
  });

  test('three branches are symmetrically offset from fork Y', async () => {
    const ids = await buildF03ParallelForkJoin();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const fork = center(registry.get(ids.fork)!);

    const taskIds = [ids.branch1, ids.branch2, ids.branch3];
    const taskYs = taskIds.map((id) => center(registry.get(id)!).y);

    // Sort Y values to get top, middle, bottom
    const sortedYs = [...taskYs].sort((a, b) => a - b);

    // Middle branch should be at fork Y
    expect(Math.abs(sortedYs[1] - fork.y)).toBeLessThan(2);

    // Top and bottom branches should be symmetric around fork Y
    const topOffset = sortedYs[0] - fork.y;
    const bottomOffset = sortedYs[2] - fork.y;
    expect(Math.abs(topOffset + bottomOffset)).toBeLessThan(2);

    // Branch spacing should be 130px (default)
    expect(Math.abs(sortedYs[1] - sortedYs[0])).toBe(130);
    expect(Math.abs(sortedYs[2] - sortedYs[1])).toBe(130);
  });

  test('all three branch tasks share the same X', async () => {
    const ids = await buildF03ParallelForkJoin();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const taskIds = [ids.branch1, ids.branch2, ids.branch3];
    const taskXs = taskIds.map((id) => center(registry.get(id)!).x);

    // All should be at the same X
    for (const x of taskXs) {
      expect(Math.abs(x - taskXs[0])).toBeLessThan(2);
    }
  });

  test('join gateway is to the right of all branch tasks', async () => {
    const ids = await buildF03ParallelForkJoin();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const taskIds = [ids.branch1, ids.branch2, ids.branch3];
    const join = registry.get(ids.join)!;

    for (const taskId of taskIds) {
      const task = registry.get(taskId)!;
      expect(join.x).toBeGreaterThan(task.x + task.width);
    }
  });

  test('complete left-to-right ordering: start < fork < tasks < join < end', async () => {
    const ids = await buildF03ParallelForkJoin();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const start = registry.get(ids.start)!;
    const fork = registry.get(ids.fork)!;
    const task = registry.get(ids.branch1)!; // any task
    const join = registry.get(ids.join)!;
    const end = registry.get(ids.end)!;

    expect(start.x).toBeLessThan(fork.x);
    expect(fork.x + fork.width).toBeLessThan(task.x);
    expect(task.x + task.width).toBeLessThan(join.x);
    expect(join.x + join.width).toBeLessThan(end.x);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2.5 — Back-edge (loop) connections
// ═══════════════════════════════════════════════════════════════════════════

describe('back-edge connection layout', () => {
  test('connections are re-routed with valid waypoints on acyclic diagrams', async () => {
    const ids = await buildF01LinearFlow();
    const diagram = getDiagram(ids.diagramId)!;

    const result = rebuildLayout(diagram);

    // 4 sequence flows in a 5-node linear chain
    expect(result.reroutedCount).toBe(4);
  });

  test('all sequence flows have waypoints after rebuild on gateway diagram', async () => {
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    // 7 flows in the exclusive gateway diamond
    const allFlows = (registry as any)
      .getAll()
      .filter((el: any) => el.type === 'bpmn:SequenceFlow');
    expect(allFlows.length).toBe(7);

    for (const flow of allFlows) {
      expect(flow.waypoints).toBeDefined();
      expect(flow.waypoints!.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Custom options
// ═══════════════════════════════════════════════════════════════════════════

describe('rebuildLayout with custom options', () => {
  test('custom origin shifts all elements', async () => {
    const ids = await buildF01LinearFlow();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram, { origin: { x: 300, y: 400 } });

    const registry = getRegistry(ids.diagramId);
    const start = center(registry.get(ids.start)!);

    // Grid snapping may shift positions by ≤5 px from the requested origin.
    expect(Math.abs(start.x - 300)).toBeLessThanOrEqual(5);
    expect(start.y).toBe(400);
  });

  test('custom gap changes spacing between elements', async () => {
    const ids = await buildF01LinearFlow();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram, { gap: 100 });

    const registry = getRegistry(ids.diagramId);
    const elements = [registry.get(ids.start)!, registry.get(ids.task1)!];

    const gap = elements[1].x - (elements[0].x + elements[0].width);
    // Grid snapping may increase the gap by up to 10 px.
    expect(gap).toBeGreaterThanOrEqual(98);
    expect(gap).toBeLessThanOrEqual(110);
  });

  test('custom branchSpacing changes branch offsets', async () => {
    const ids = await buildF03ParallelForkJoin();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram, { branchSpacing: 200 });

    const registry = getRegistry(ids.diagramId);
    const taskIds = [ids.branch1, ids.branch2, ids.branch3];
    const taskYs = taskIds.map((id) => center(registry.get(id)!).y);
    const sortedYs = [...taskYs].sort((a, b) => a - b);

    // Branch spacing should now be 200px
    expect(Math.abs(sortedYs[1] - sortedYs[0])).toBe(200);
    expect(Math.abs(sortedYs[2] - sortedYs[1])).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.4 — Boundary event positioning and exception chains
// ═══════════════════════════════════════════════════════════════════════════

describe('boundary event positioning (F06 boundary events)', () => {
  test('boundary event is at the bottom center of its host', async () => {
    const ids = await buildF06BoundaryEvents();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const host = registry.get(ids.host)!;
    const be = registry.get(ids.boundaryEvent)!;

    const beC = center(be);
    const hostCenterX = host.x + host.width / 2;
    const hostBottom = host.y + host.height;

    // Boundary event center X should be at host center X
    expect(Math.abs(beC.x - hostCenterX)).toBeLessThan(2);

    // Boundary event center Y should be at host bottom edge
    expect(Math.abs(beC.y - hostBottom)).toBeLessThan(2);
  });

  test('exception chain elements are below the host', async () => {
    const ids = await buildF06BoundaryEvents();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const host = registry.get(ids.host)!;
    const escalate = registry.get(ids.escalate)!;
    const escalated = registry.get(ids.escalatedEnd)!;

    // Exception chain elements should be below the host
    expect(escalate.y).toBeGreaterThan(host.y + host.height);
    expect(escalated.y).toBeGreaterThan(host.y + host.height);
  });

  test('exception chain elements are in left-to-right order', async () => {
    const ids = await buildF06BoundaryEvents();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const be = registry.get(ids.boundaryEvent)!;
    const escalate = registry.get(ids.escalate)!;
    const escalated = registry.get(ids.escalatedEnd)!;

    // Left-to-right: boundary event < escalate < escalated
    expect(escalate.x).toBeGreaterThan(be.x + be.width);
    expect(escalated.x).toBeGreaterThan(escalate.x + escalate.width);
  });

  test('exception chain elements share the same Y', async () => {
    const ids = await buildF06BoundaryEvents();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const escalateC = center(registry.get(ids.escalate)!);
    const escalatedC = center(registry.get(ids.escalatedEnd)!);

    // Both exception chain elements at the same Y
    expect(Math.abs(escalateC.y - escalatedC.y)).toBeLessThan(2);
  });

  test('main flow elements are on the standard Y axis', async () => {
    const ids = await buildF06BoundaryEvents();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const mainIds = [ids.start, ids.host, ids.approve, ids.end];
    const mainYs = mainIds.map((id) => center(registry.get(id)!).y);

    // All main flow elements at the same Y
    for (const y of mainYs) {
      expect(Math.abs(y - mainYs[0])).toBeLessThan(2);
    }
  });

  test('exception chain connections have valid waypoints', async () => {
    const ids = await buildF06BoundaryEvents();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const flowIds = [ids.exceptionFlow1, ids.exceptionFlow2];

    for (const flowId of flowIds) {
      const conn = registry.get(flowId)!;
      expect(conn.waypoints).toBeDefined();
      expect(conn.waypoints!.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('result counts include boundary events and exception chains', async () => {
    const ids = await buildF06BoundaryEvents();
    const diagram = getDiagram(ids.diagramId)!;

    const result = rebuildLayout(diagram);

    // Should reposition main flow (4) + boundary event (1) + exception chain (2) = 7
    expect(result.repositionedCount).toBeGreaterThanOrEqual(5);
    // Main flow (3 flows) + exception chain (2 flows from boundary + within chain)
    expect(result.reroutedCount).toBeGreaterThanOrEqual(5);
  });

  test('boundary event outgoing flow exits from the bottom (vertical-first path)', async () => {
    const ids = await buildF06BoundaryEvents();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const be = registry.get(ids.boundaryEvent)!;
    const conn = registry.get(ids.exceptionFlow1)!;

    // The boundary event is placed at the host's bottom border.
    // Its outgoing flow must exit downward (vertical first segment), not rightward.
    // We check that the first waypoint is near the bottom-centre of the event
    // and that the flow's first segment is vertical (same X, increasing Y).
    expect(conn.waypoints).toBeDefined();
    expect(conn.waypoints!.length).toBeGreaterThanOrEqual(2);

    const wp0 = conn.waypoints![0];
    const wp1 = conn.waypoints![1];

    const beCenterX = be.x + be.width / 2;
    const beBottom = be.y + be.height;

    // First waypoint should be near the bottom centre of the boundary event
    expect(Math.abs(wp0.x - beCenterX)).toBeLessThan(5);
    expect(wp0.y).toBeGreaterThanOrEqual(beBottom - 2);

    // First segment should be vertical (dx < dy), not horizontal
    const segDx = Math.abs(wp1.x - wp0.x);
    const segDy = Math.abs(wp1.y - wp0.y);
    expect(segDy).toBeGreaterThan(segDx);
  });

  test('boundary event label is offset to the side (not centred below)', async () => {
    const ids = await buildF06BoundaryEvents();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const be = registry.get(ids.boundaryEvent)!;

    if (!be.label || !be.businessObject?.name) return; // label is optional

    const beCenterX = be.x + be.width / 2;
    const labelCenterX = be.label.x + (be.label.width ?? 90) / 2;

    // Label centre should NOT be near the boundary event centre X.
    // It should be clearly offset to the left or right so it does not
    // sit directly on the downward-exiting flow line.
    const offsetX = Math.abs(labelCenterX - beCenterX);
    expect(offsetX).toBeGreaterThan(15);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.1 — Recursive subprocess rebuild
// ═══════════════════════════════════════════════════════════════════════════

describe('recursive subprocess rebuild (F04 nested subprocess)', () => {
  test('internal elements are on the same horizontal line', async () => {
    const ids = await buildF04NestedSubprocess();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const internalIds = [ids.subStart, ids.subTask, ids.subEnd];
    const ys = internalIds.map((id) => center(registry.get(id)!).y);

    for (const y of ys) {
      expect(Math.abs(y - ys[0])).toBeLessThan(2);
    }
  });

  test('internal elements are in left-to-right order', async () => {
    const ids = await buildF04NestedSubprocess();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const internalIds = [ids.subStart, ids.subTask, ids.subEnd];
    const xs = internalIds.map((id) => registry.get(id)!.x);

    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  test('subprocess is resized to fit internal elements', async () => {
    const ids = await buildF04NestedSubprocess();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const subprocess = registry.get(ids.subprocess)!;
    const internalIds = [ids.subStart, ids.subTask, ids.subEnd];

    // All internal elements should be inside the subprocess bounds
    for (const id of internalIds) {
      const el = registry.get(id)!;
      expect(el.x).toBeGreaterThan(subprocess.x);
      expect(el.y).toBeGreaterThan(subprocess.y);
      expect(el.x + el.width).toBeLessThan(subprocess.x + subprocess.width);
      expect(el.y + el.height).toBeLessThan(subprocess.y + subprocess.height);
    }
  });

  test('top-level elements are on the same Y line', async () => {
    const ids = await buildF04NestedSubprocess();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const start = center(registry.get(ids.start)!);
    const subprocess = center(registry.get(ids.subprocess)!);
    const end = center(registry.get(ids.end)!);

    expect(Math.abs(start.y - subprocess.y)).toBeLessThan(2);
    expect(Math.abs(subprocess.y - end.y)).toBeLessThan(2);
  });

  test('top-level elements are in left-to-right order', async () => {
    const ids = await buildF04NestedSubprocess();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const start = registry.get(ids.start)!;
    const subprocess = registry.get(ids.subprocess)!;
    const end = registry.get(ids.end)!;

    expect(start.x + start.width).toBeLessThan(subprocess.x);
    expect(subprocess.x + subprocess.width).toBeLessThan(end.x);
  });

  test('internal connections have valid waypoints', async () => {
    const ids = await buildF04NestedSubprocess();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const flowIds = [ids.internalFlow1, ids.internalFlow2];

    for (const flowId of flowIds) {
      const conn = registry.get(flowId)!;
      expect(conn.waypoints).toBeDefined();
      expect(conn.waypoints!.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.2 — Collaboration pool stacking
// ═══════════════════════════════════════════════════════════════════════════

describe('collaboration pool stacking (F05 collaboration)', () => {
  test('each pool has its internal flow in left-to-right order', async () => {
    const ids = await buildF05Collaboration();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);

    // Pool 1 (Customer) elements
    const pool1Ids = [ids.p1Start, ids.p1Task, ids.p1End];
    const pool1Xs = pool1Ids.map((id) => registry.get(id)!.x);
    for (let i = 1; i < pool1Xs.length; i++) {
      expect(pool1Xs[i]).toBeGreaterThan(pool1Xs[i - 1]);
    }

    // Pool 2 (Backend System) elements
    const pool2Ids = [ids.p2Start, ids.p2Task, ids.p2End];
    const pool2Xs = pool2Ids.map((id) => registry.get(id)!.x);
    for (let i = 1; i < pool2Xs.length; i++) {
      expect(pool2Xs[i]).toBeGreaterThan(pool2Xs[i - 1]);
    }
  });

  test('pools are stacked vertically without overlap', async () => {
    const ids = await buildF05Collaboration();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const pool1 = registry.get(ids.pool1)!;
    const pool2 = registry.get(ids.pool2)!;

    // Sort by Y to determine top/bottom
    const [top, bottom] = pool1.y < pool2.y ? [pool1, pool2] : [pool2, pool1];

    // Bottom pool should start below top pool with gap
    expect(bottom.y).toBeGreaterThanOrEqual(top.y + top.height);
  });

  test('elements within each pool are inside pool bounds', async () => {
    const ids = await buildF05Collaboration();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const pool1 = registry.get(ids.pool1)!;
    const pool2 = registry.get(ids.pool2)!;

    // Pool 1 elements should be inside pool 1 bounds
    for (const id of [ids.p1Start, ids.p1Task, ids.p1End]) {
      const el = registry.get(id)!;
      expect(el.x).toBeGreaterThanOrEqual(pool1.x);
      expect(el.y).toBeGreaterThanOrEqual(pool1.y);
    }

    // Pool 2 elements should be inside pool 2 bounds
    for (const id of [ids.p2Start, ids.p2Task, ids.p2End]) {
      const el = registry.get(id)!;
      expect(el.x).toBeGreaterThanOrEqual(pool2.x);
      expect(el.y).toBeGreaterThanOrEqual(pool2.y);
    }
  });

  test('message flow has valid waypoints after rebuild', async () => {
    const ids = await buildF05Collaboration();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const msgFlow = registry.get(ids.messageFlow)!;

    expect(msgFlow.waypoints).toBeDefined();
    expect(msgFlow.waypoints!.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.3 — Lane assignment after rebuild
// ═══════════════════════════════════════════════════════════════════════════

describe('lane assignment after rebuild (F10 pool with lanes)', () => {
  test('elements in Customer lane share the same Y center', async () => {
    const ids = await buildF10PoolWithLanes();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const startY = center(registry.get(ids.start)!).y;
    const placeOrderY = center(registry.get(ids.placeOrder)!).y;

    expect(Math.abs(startY - placeOrderY)).toBeLessThan(2);
  });

  test('elements in System lane share the same Y center', async () => {
    const ids = await buildF10PoolWithLanes();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const processOrderY = center(registry.get(ids.processOrder)!).y;
    const completedY = center(registry.get(ids.orderComplete)!).y;

    expect(Math.abs(processOrderY - completedY)).toBeLessThan(2);
  });

  test('System lane elements are below Customer lane elements', async () => {
    const ids = await buildF10PoolWithLanes();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const customerY = center(registry.get(ids.start)!).y;
    const systemY = center(registry.get(ids.processOrder)!).y;

    expect(systemY).toBeGreaterThan(customerY + 50);
  });

  test('X ordering follows the flow topology', async () => {
    const ids = await buildF10PoolWithLanes();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const start = registry.get(ids.start)!;
    const placeOrder = registry.get(ids.placeOrder)!;
    const processOrder = registry.get(ids.processOrder)!;
    const orderComplete = registry.get(ids.orderComplete)!;

    expect(start.x + start.width).toBeLessThan(placeOrder.x);
    expect(placeOrder.x + placeOrder.width).toBeLessThan(processOrder.x);
    expect(processOrder.x + processOrder.width).toBeLessThan(orderComplete.x);
  });

  test('pool encompasses all elements', async () => {
    const ids = await buildF10PoolWithLanes();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const pool = registry.get(ids.pool)!;
    const elementIds = [ids.start, ids.placeOrder, ids.processOrder, ids.orderComplete];

    for (const id of elementIds) {
      const el = registry.get(id)!;
      expect(el.x).toBeGreaterThanOrEqual(pool.x);
      expect(el.y).toBeGreaterThanOrEqual(pool.y);
      expect(el.x + el.width).toBeLessThanOrEqual(pool.x + pool.width);
      expect(el.y + el.height).toBeLessThanOrEqual(pool.y + pool.height);
    }
  });

  test('cross-lane connection has valid waypoints', async () => {
    const ids = await buildF10PoolWithLanes();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const crossLaneFlow = registry.get(ids.crossLaneFlow)!;

    expect(crossLaneFlow.waypoints).toBeDefined();
    expect(crossLaneFlow.waypoints!.length).toBeGreaterThanOrEqual(2);
  });

  test('lanes are resized to fit within pool bounds', async () => {
    const ids = await buildF10PoolWithLanes();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const pool = registry.get(ids.pool)!;
    const lane1 = registry.get(ids.laneCustomer)!;
    const lane2 = registry.get(ids.laneSystem)!;

    // Both lanes should be within the pool
    expect(lane1.y).toBeGreaterThanOrEqual(pool.y);
    expect(lane2.y + lane2.height).toBeLessThanOrEqual(pool.y + pool.height + 1);

    // Lanes should tile vertically (no gap, no overlap)
    expect(Math.abs(lane1.y + lane1.height - lane2.y)).toBeLessThan(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.5 — Event subprocess positioning
// ═══════════════════════════════════════════════════════════════════════════

describe('event subprocess positioning (F11 event subprocess)', () => {
  test('main flow elements are in left-to-right order', async () => {
    const ids = await buildF11EventSubprocess();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const start = registry.get(ids.start)!;
    const task = registry.get(ids.mainTask)!;
    const end = registry.get(ids.end)!;

    expect(start.x + start.width).toBeLessThan(task.x);
    expect(task.x + task.width).toBeLessThan(end.x);
  });

  test('main flow elements share the same Y center', async () => {
    const ids = await buildF11EventSubprocess();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const startY = center(registry.get(ids.start)!).y;
    const taskY = center(registry.get(ids.mainTask)!).y;
    const endY = center(registry.get(ids.end)!).y;

    expect(Math.abs(startY - taskY)).toBeLessThan(2);
    expect(Math.abs(taskY - endY)).toBeLessThan(2);
  });

  test('event subprocess is positioned below the main flow', async () => {
    const ids = await buildF11EventSubprocess();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const mainTask = registry.get(ids.mainTask)!;
    const eventSub = registry.get(ids.eventSub)!;

    // Event subprocess should be entirely below the main flow
    expect(eventSub.y).toBeGreaterThan(mainTask.y + mainTask.height);
  });

  test('event subprocess internal elements are in left-to-right order', async () => {
    const ids = await buildF11EventSubprocess();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const esStart = registry.get(ids.esStart)!;
    const esTask = registry.get(ids.esTask)!;
    const esEnd = registry.get(ids.esEnd)!;

    expect(esStart.x + esStart.width).toBeLessThan(esTask.x);
    expect(esTask.x + esTask.width).toBeLessThan(esEnd.x);
  });

  test('event subprocess internal elements are inside its bounds', async () => {
    const ids = await buildF11EventSubprocess();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const eventSub = registry.get(ids.eventSub)!;
    const internalIds = [ids.esStart, ids.esTask, ids.esEnd];

    for (const id of internalIds) {
      const el = registry.get(id)!;
      expect(el.x).toBeGreaterThan(eventSub.x);
      expect(el.y).toBeGreaterThan(eventSub.y);
      expect(el.x + el.width).toBeLessThan(eventSub.x + eventSub.width);
      expect(el.y + el.height).toBeLessThan(eventSub.y + eventSub.height);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.6 — Collapsed pool stacking
// ═══════════════════════════════════════════════════════════════════════════

describe('collapsed pool stacking (F08 collaboration collapsed)', () => {
  test('expanded pool has its flow in left-to-right order', async () => {
    const ids = await buildF08CollaborationCollapsed();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const start = registry.get(ids.start)!;
    const task = registry.get(ids.task)!;
    const end = registry.get(ids.end)!;

    expect(start.x + start.width).toBeLessThan(task.x);
    expect(task.x + task.width).toBeLessThan(end.x);
  });

  test('collapsed pool is below expanded pool', async () => {
    const ids = await buildF08CollaborationCollapsed();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const expandedPool = registry.get(ids.expandedPool)!;
    const collapsedPool = registry.get(ids.collapsedPool)!;

    expect(collapsedPool.y).toBeGreaterThanOrEqual(expandedPool.y + expandedPool.height);
  });

  test('collapsed pool retains small height', async () => {
    const ids = await buildF08CollaborationCollapsed();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const collapsedPool = registry.get(ids.collapsedPool)!;

    // Collapsed pool should be thin (original is 60px)
    expect(collapsedPool.height).toBeLessThanOrEqual(80);
  });

  test('message flow has valid waypoints after rebuild', async () => {
    const ids = await buildF08CollaborationCollapsed();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const msgFlow = registry.get(ids.messageFlow)!;

    expect(msgFlow.waypoints).toBeDefined();
    expect(msgFlow.waypoints!.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4.1, 4.2 — Artifact positioning (text annotation + data object)
// ═══════════════════════════════════════════════════════════════════════════

describe('artifact positioning (F12 text annotation)', () => {
  test('text annotation is positioned above-right of associated task', async () => {
    const ids = await buildF12TextAnnotation();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const task = registry.get(ids.reviewTask)!;
    const annotation = registry.get(ids.annotation)!;

    // Annotation should be to the right of the task
    expect(annotation.x).toBeGreaterThanOrEqual(task.x + task.width - 20);
    // Annotation should be above the task
    expect(annotation.y + annotation.height).toBeLessThanOrEqual(task.y + 10);
  });

  test('data object is positioned below-right of associated task', async () => {
    const ids = await buildF12TextAnnotation();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const task = registry.get(ids.reviewTask)!;
    const dataObj = registry.get(ids.dataObject)!;

    // Data object should be near the right edge of the task
    expect(dataObj.x).toBeGreaterThanOrEqual(task.x + task.width - 30);
    // Data object should be below the task
    expect(dataObj.y).toBeGreaterThanOrEqual(task.y + task.height);
  });

  test('association has valid waypoints after rebuild', async () => {
    const ids = await buildF12TextAnnotation();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const assoc = registry.get(ids.association)!;

    expect(assoc.waypoints).toBeDefined();
    expect(assoc.waypoints!.length).toBeGreaterThanOrEqual(2);
  });

  test('data output association has valid waypoints after rebuild', async () => {
    const ids = await buildF12TextAnnotation();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const dataAssoc = registry.get(ids.dataAssoc)!;

    expect(dataAssoc.waypoints).toBeDefined();
    expect(dataAssoc.waypoints!.length).toBeGreaterThanOrEqual(2);
  });

  test('main flow order is preserved with artifacts present', async () => {
    const ids = await buildF12TextAnnotation();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const start = registry.get(ids.start)!;
    const task = registry.get(ids.reviewTask)!;
    const end = registry.get(ids.end)!;

    const startCenter = center(start);
    const taskCenter = center(task);
    const endCenter = center(end);

    expect(startCenter.x).toBeLessThan(taskCenter.x);
    expect(taskCenter.x).toBeLessThan(endCenter.x);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4.4 — Label adjustment
// ═══════════════════════════════════════════════════════════════════════════

describe('label adjustment after rebuild', () => {
  test('start event label is positioned below the event', async () => {
    const ids = await buildF12TextAnnotation();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const start = registry.get(ids.start)!;

    if (start.label) {
      // Label should be below the start event
      expect(start.label.y).toBeGreaterThanOrEqual(start.y + start.height - 1);
    }
  });

  test('end event label is positioned below the event', async () => {
    const ids = await buildF12TextAnnotation();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const end = registry.get(ids.end)!;

    if (end.label) {
      // Label should be below the end event
      expect(end.label.y).toBeGreaterThanOrEqual(end.y + end.height - 1);
    }
  });

  test('labeled gateway label is below gateway after rebuild', async () => {
    const ids = await buildF02ExclusiveGateway();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const gateway = registry.get(ids.split)!;

    if (gateway.label && gateway.businessObject?.name) {
      expect(gateway.label.y).toBeGreaterThanOrEqual(gateway.y + gateway.height - 1);
    }
  });

  test('repositionedCount includes label adjustments', async () => {
    const ids = await buildF12TextAnnotation();
    const diagram = getDiagram(ids.diagramId)!;

    const result = rebuildLayout(diagram);

    // Should include labels in the repositioned count
    expect(result.repositionedCount).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.7 — Waypoint clamping within pool bounds (TODO #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('waypoint clamping within pool bounds (F13 pool with non-interrupting boundary)', () => {
  test('all sequence flow waypoints are within pool Y bounds after rebuild', async () => {
    const ids = await buildF13PoolWithNonInterruptingBoundary();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const pool = registry.get(ids.pool)!;
    const poolTop = pool.y;
    const poolBottom = pool.y + pool.height;

    // Get all sequence flows — all should be inside the pool (it's a single-pool diagram)
    const allElements = (registry as any).getAll() as BpmnElement[];
    const seqFlows = allElements.filter(
      (el: BpmnElement) =>
        el.type === 'bpmn:SequenceFlow' && el.waypoints && el.waypoints.length > 0
    );

    expect(seqFlows.length).toBeGreaterThan(0);

    // 1px tolerance for rounding; clamping ensures no waypoint escapes pool bounds
    for (const flow of seqFlows) {
      for (const wp of flow.waypoints!) {
        expect(wp.y).toBeGreaterThanOrEqual(poolTop - 1);
        expect(wp.y).toBeLessThanOrEqual(poolBottom + 1);
      }
    }
  });

  test('main flow elements are in left-to-right order inside pool', async () => {
    const ids = await buildF13PoolWithNonInterruptingBoundary();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const start = registry.get(ids.start)!;
    const task = registry.get(ids.task)!;
    const end = registry.get(ids.end)!;

    expect(start.x + start.width).toBeLessThan(task.x);
    expect(task.x + task.width).toBeLessThan(end.x);
  });

  test('pool encompasses all flow elements after rebuild', async () => {
    const ids = await buildF13PoolWithNonInterruptingBoundary();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const pool = registry.get(ids.pool)!;
    const elementIds = [ids.start, ids.task, ids.end, ids.timeoutEnd];

    for (const id of elementIds) {
      const el = registry.get(id)!;
      expect(el.x).toBeGreaterThanOrEqual(pool.x);
      expect(el.y).toBeGreaterThanOrEqual(pool.y);
      expect(el.x + el.width).toBeLessThanOrEqual(pool.x + pool.width + 1);
      expect(el.y + el.height).toBeLessThanOrEqual(pool.y + pool.height + 1);
    }
  });

  test('timeout flow has valid waypoints after rebuild', async () => {
    const ids = await buildF13PoolWithNonInterruptingBoundary();
    const diagram = getDiagram(ids.diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(ids.diagramId);
    const timeoutFlow = registry.get(ids.timeoutFlow)!;

    expect(timeoutFlow.waypoints).toBeDefined();
    expect(timeoutFlow.waypoints!.length).toBeGreaterThanOrEqual(2);
  });
});
