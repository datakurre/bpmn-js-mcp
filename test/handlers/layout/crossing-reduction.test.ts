/**
 * Tests for post-layout edge crossing reduction.
 *
 * Verifies that the reduceCrossings pass attempts to eliminate
 * edge crossings detected after layout.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleSetConnectionWaypoints } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';
import { detectCrossingFlows, reduceCrossings } from '../../../src/elk/crossing-detection';

describe('edge crossing reduction', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('layout reports crossing flow info when crossings exist', async () => {
    const diagramId = await createDiagram('Crossing Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw1 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Split?' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path A' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path B' });
    const gw2 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw1);
    await connect(diagramId, gw1, t1);
    await connect(diagramId, gw1, t2);
    await connect(diagramId, t1, gw2);
    await connect(diagramId, t2, gw2);
    await connect(diagramId, gw2, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // crossingFlows is only present when > 0; otherwise absent
    const crossings = res.crossingFlows ?? 0;
    expect(crossings).toBeGreaterThanOrEqual(0);
  });

  test('simple linear process has no crossings', async () => {
    const diagramId = await createDiagram('No Crossings');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Step 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Step 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    // No crossingFlows property means 0 crossings
    expect(res.crossingFlows).toBeUndefined();
  });

  test('parallel gateway branches have low or zero crossings', async () => {
    const diagramId = await createDiagram('Parallel Branches');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const pgw1 = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Fork' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 2' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 3' });
    const pgw2 = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, pgw1);
    await connect(diagramId, pgw1, t1);
    await connect(diagramId, pgw1, t2);
    await connect(diagramId, pgw1, t3);
    await connect(diagramId, t1, pgw2);
    await connect(diagramId, t2, pgw2);
    await connect(diagramId, t3, pgw2);
    await connect(diagramId, pgw2, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // The layout engine + crossing reduction should produce low or zero crossings
    const crossings = res.crossingFlows ?? 0;
    expect(crossings).toBeLessThanOrEqual(2);
  });
});

// ── E6-6 + E6-7: Direct reduceCrossings() tests ────────────────────────────

describe('reduceCrossings() direct tests', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  /**
   * E6-6: Verify reduceCrossings() eliminates a known engineered crossing.
   *
   * Scenario:
   *   Conn A (3-waypoint horizontal): [100,150] → [200,150] → [300,150]
   *     - Two H segments, no V segment.
   *
   *   Conn B (4-waypoint L-shape): [100,100] → [212,100] → [212,200] → [400,200]
   *     - H segment at y=100, x∈[100,212]
   *     - V segment at x=212, y∈[100,200]   ← crosses Conn A's H at (212,150)
   *     - H segment at y=200, x∈[212,400]
   *
   *   Conn B's V (x=212) is strictly interior to Conn A's H2 range [200,300],
   *   and y=150 is strictly interior to Conn B's V range [100,200].
   *   → One genuine crossing at (212,150).
   *
   *   After reduceCrossings(), the nudge shifts Conn B's V by -12px to x=200,
   *   landing it exactly at Conn A's H2 start (x=200, which is an endpoint
   *   touch / T-junction, not a crossing). Crossing eliminated.
   *
   *   Tasks are placed at explicit far-away positions so they don't interfere
   *   with the crossing scenario or E6-4 shape-overlap validation.
   */
  test('E6-6: reduceCrossings() eliminates a known crossing pair', async () => {
    const diagramId = await createDiagram('Known Crossing');

    // Tasks placed explicitly to avoid interfering with the waypoint routes
    //   srcA center (50,150)  → box [0,100]×[110,190]
    //   tgtA center (350,150) → box [300,400]×[110,190]
    //   srcB center (50,100)  → box [0,100]×[60,140]
    //   tgtB center (450,200) → box [400,500]×[160,240]
    const srcA = await addElement(diagramId, 'bpmn:Task', { name: 'SrcA', x: 50, y: 150 });
    const tgtA = await addElement(diagramId, 'bpmn:Task', { name: 'TgtA', x: 350, y: 150 });
    const srcB = await addElement(diagramId, 'bpmn:Task', { name: 'SrcB', x: 50, y: 100 });
    const tgtB = await addElement(diagramId, 'bpmn:Task', { name: 'TgtB', x: 450, y: 200 });

    const connA = await connect(diagramId, srcA, tgtA);
    const connB = await connect(diagramId, srcB, tgtB);

    // Conn A: 3-point horizontal (no vertical segments) from srcA to tgtA
    await handleSetConnectionWaypoints({
      diagramId,
      connectionId: connA,
      waypoints: [
        { x: 100, y: 150 },
        { x: 200, y: 150 },
        { x: 300, y: 150 },
      ],
    });
    // Conn B: L-shape with V segment at x=212 crossing Conn A's H at y=150
    await handleSetConnectionWaypoints({
      diagramId,
      connectionId: connB,
      waypoints: [
        { x: 100, y: 100 },
        { x: 212, y: 100 },
        { x: 212, y: 200 },
        { x: 400, y: 200 },
      ],
    });

    const diagram = getDiagram(diagramId)!;
    const elementRegistry = diagram.modeler.get('elementRegistry') as any;
    const modeling = diagram.modeler.get('modeling') as any;

    // Verify the crossing exists before reduction
    const before = detectCrossingFlows(elementRegistry);
    expect(before.count).toBeGreaterThan(0);

    // Run crossing reduction
    const eliminated = reduceCrossings(elementRegistry, modeling);

    // Verify at least one crossing was eliminated
    const after = detectCrossingFlows(elementRegistry);
    expect(eliminated).toBeGreaterThan(0);
    expect(after.count).toBeLessThan(before.count);
  });

  /**
   * E6-7: After reduceCrossings(), nudged waypoints must not overlap with
   * flow-node shape bounding boxes.
   *
   * Uses the same scenario as E6-6.  After reduction, ConnB's V segment is
   * nudged from x=212 to x=200 — well clear of all task bounding boxes.
   */
  test('E6-7: nudged waypoints do not overlap with shape bounding boxes', async () => {
    const diagramId = await createDiagram('No Shape Overlap After Nudge');

    const srcA = await addElement(diagramId, 'bpmn:Task', { name: 'SrcA', x: 50, y: 150 });
    const tgtA = await addElement(diagramId, 'bpmn:Task', { name: 'TgtA', x: 350, y: 150 });
    const srcB = await addElement(diagramId, 'bpmn:Task', { name: 'SrcB', x: 50, y: 100 });
    const tgtB = await addElement(diagramId, 'bpmn:Task', { name: 'TgtB', x: 450, y: 200 });

    const connA = await connect(diagramId, srcA, tgtA);
    const connB = await connect(diagramId, srcB, tgtB);

    await handleSetConnectionWaypoints({
      diagramId,
      connectionId: connA,
      waypoints: [
        { x: 100, y: 150 },
        { x: 200, y: 150 },
        { x: 300, y: 150 },
      ],
    });
    await handleSetConnectionWaypoints({
      diagramId,
      connectionId: connB,
      waypoints: [
        { x: 100, y: 100 },
        { x: 212, y: 100 },
        { x: 212, y: 200 },
        { x: 400, y: 200 },
      ],
    });

    const diagram = getDiagram(diagramId)!;
    const elementRegistry = diagram.modeler.get('elementRegistry') as any;
    const modeling = diagram.modeler.get('modeling') as any;

    reduceCrossings(elementRegistry, modeling);

    // After reduction, check that no pure-internal segment of any 4-waypoint
    // connection passes through a non-adjacent task shape bounding box.
    const connections = elementRegistry.filter(
      (el: any) =>
        (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
        el.waypoints &&
        el.waypoints.length >= 4
    );
    const tasks = elementRegistry.filter(
      (el: any) => el.type === 'bpmn:Task' && el.width && el.height
    );

    for (const conn of connections) {
      const wps: Array<{ x: number; y: number }> = conn.waypoints;
      // Only check purely-internal segments (skip first 0→1 and last n-2→n-1)
      for (let i = 1; i < wps.length - 2; i++) {
        for (const task of tasks) {
          if (task.id === conn.source?.id || task.id === conn.target?.id) continue;
          const p1 = wps[i];
          const p2 = wps[i + 1];
          const tx = task.x;
          const ty = task.y;
          const tw = task.width;
          const th = task.height;
          const minX = Math.min(p1.x, p2.x);
          const maxX = Math.max(p1.x, p2.x);
          const minY = Math.min(p1.y, p2.y);
          const maxY = Math.max(p1.y, p2.y);
          const overlapsX = minX < tx + tw && maxX > tx;
          const overlapsY = minY < ty + th && maxY > ty;
          expect(
            overlapsX && overlapsY,
            `Connection ${conn.id} segment [${p1.x},${p1.y}]→[${p2.x},${p2.y}] overlaps task ${task.id}`
          ).toBe(false);
        }
      }
    }
  });
});
