/**
 * Tests for the `straightenFlows` post-layout pass.
 *
 * `straightenFlows: true` adds a post-layout step that replaces
 * non-orthogonal (Z-shaped / diagonal) forward sequence-flow waypoints
 * with clean L-shaped or 2-point straight paths.
 *
 * The pass runs:
 *  1. After the full rebuild (when `straightenFlows: true` without `labelsOnly`)
 *  2. As a standalone fix (when `straightenFlows: true, labelsOnly: true`)
 *
 * Unit tests (no modeler) operate on the exported `straightenNonOrthogonalFlows`
 * function directly. Integration tests verify end-to-end behaviour through
 * the `handleLayoutDiagram` handler.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { straightenNonOrthogonalFlows } from '../../../src/rebuild/waypoints';
import { handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

// ── Mock helpers ───────────────────────────────────────────────────────────

interface MockBox {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parent?: { children: MockBox[] };
}

/** Build a pair of shapes with a common parent so getSiblingBounds works. */
function makeForwardConn(
  sourceBox: { x: number; y: number; width: number; height: number },
  targetBox: { x: number; y: number; width: number; height: number },
  waypoints: Array<{ x: number; y: number }>,
  siblings: MockBox[] = []
): any {
  const source: MockBox = { id: 'source', type: 'bpmn:Task', ...sourceBox };
  const target: MockBox = { id: 'target', type: 'bpmn:Task', ...targetBox };
  const parent = { children: [source, target, ...siblings] };
  source.parent = parent;
  target.parent = parent;
  return {
    type: 'bpmn:SequenceFlow',
    source,
    target,
    waypoints: waypoints.map((wp) => ({ ...wp })),
  };
}

function makeBackwardConn(waypoints: Array<{ x: number; y: number }>): any {
  // Source is to the RIGHT of target (right-to-left = back-edge)
  const source: MockBox = {
    id: 'source',
    type: 'bpmn:Task',
    x: 400,
    y: 160,
    width: 100,
    height: 80,
  };
  const target: MockBox = {
    id: 'target',
    type: 'bpmn:Task',
    x: 100,
    y: 160,
    width: 100,
    height: 80,
  };
  return {
    type: 'bpmn:SequenceFlow',
    source,
    target,
    waypoints: waypoints.map((wp) => ({ ...wp })),
  };
}

/** Assert all waypoint segments are strictly horizontal or vertical (within 1 px). */
function assertOrthogonal(wps: Array<{ x: number; y: number }>, label?: string) {
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    expect(
      dx < 1 || dy < 1,
      `${label ?? 'Connection'} segment ${i - 1}→${i} is diagonal: ` +
        `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
    ).toBe(true);
  }
}

// ── Unit tests (mock connections, no modeler) ──────────────────────────────

describe('straightenNonOrthogonalFlows — unit', () => {
  test('straightens a Z-shaped same-Y forward flow to a 2-point straight path', () => {
    // Source: (100,160) 100×80 → midY=200  Target: (400,160) 100×80 → midY=200
    // Z-shape: exit right (200,200) → diagonal (250,205) → enter left (400,200)
    const conn = makeForwardConn(
      { x: 100, y: 160, width: 100, height: 80 },
      { x: 400, y: 160, width: 100, height: 80 },
      [
        { x: 200, y: 200 },
        { x: 250, y: 205 }, // diagonal segment!
        { x: 400, y: 200 },
      ]
    );

    const count = straightenNonOrthogonalFlows([conn]);

    expect(count).toBe(1);
    // Same-Y (within SAME_Y_TOLERANCE=5) → 2-point straight path
    expect(conn.waypoints.length).toBe(2);
    expect(conn.waypoints[0].y).toBeCloseTo(conn.waypoints[1].y, 0);
    assertOrthogonal(conn.waypoints, 'same-Y forward flow');
  });

  test('straightens a Z-shaped different-Y forward flow to a 4-point L-shape', () => {
    // Source midY=200, Target midY=280 — different rows
    // Z-shape: non-orthogonal diagonal step in the middle
    const conn = makeForwardConn(
      { x: 100, y: 160, width: 100, height: 80 }, // midY=200
      { x: 400, y: 240, width: 100, height: 80 }, // midY=280
      [
        { x: 200, y: 200 },
        { x: 300, y: 240 }, // diagonal!
        { x: 400, y: 280 },
      ]
    );

    const count = straightenNonOrthogonalFlows([conn]);

    expect(count).toBe(1);
    assertOrthogonal(conn.waypoints, 'different-Y forward flow');
  });

  test('does NOT touch already-orthogonal forward flows', () => {
    // Clean L-shape waypoints — should not be changed
    const conn = makeForwardConn(
      { x: 100, y: 160, width: 100, height: 80 }, // midY=200
      { x: 400, y: 240, width: 100, height: 80 }, // midY=280
      [
        { x: 200, y: 200 },
        { x: 300, y: 200 }, // horizontal
        { x: 300, y: 280 }, // vertical
        { x: 400, y: 280 }, // horizontal
      ]
    );
    const originalWps = conn.waypoints.map((wp: any) => ({ ...wp }));

    const count = straightenNonOrthogonalFlows([conn]);

    expect(count).toBe(0);
    expect(conn.waypoints).toEqual(originalWps);
  });

  test('does NOT touch backward (right-to-left) flows', () => {
    // U-shaped back-edge — source is right of target, should not be touched
    const conn = makeBackwardConn([
      { x: 500, y: 200 },
      { x: 550, y: 200 }, // right
      { x: 550, y: 100 }, // up
      { x: 150, y: 100 }, // left
      { x: 150, y: 200 }, // down — this whole set IS orthogonal
    ]);
    // Corrupt it to be diagonal to prove it won't be touched regardless
    conn.waypoints[2] = { x: 548, y: 102 }; // tiny diagonal

    const originalWps = conn.waypoints.map((wp: any) => ({ ...wp }));
    const count = straightenNonOrthogonalFlows([conn]);

    expect(count).toBe(0);
    expect(conn.waypoints).toEqual(originalWps);
  });

  test('does NOT touch MessageFlow or Association connections', () => {
    const msgFlow = {
      type: 'bpmn:MessageFlow',
      source: { id: 's', type: 'bpmn:Task', x: 100, y: 160, width: 100, height: 80 },
      target: { id: 't', type: 'bpmn:Task', x: 400, y: 200, width: 100, height: 80 },
      waypoints: [
        { x: 200, y: 200 },
        { x: 250, y: 205 },
        { x: 400, y: 240 },
      ], // diagonal
    };
    const originalWps = msgFlow.waypoints.map((wp) => ({ ...wp }));

    const count = straightenNonOrthogonalFlows([msgFlow]);

    expect(count).toBe(0);
    expect(msgFlow.waypoints).toEqual(originalWps);
  });

  test('does NOT collapse an intentional Z-shape (4-point fully-orthogonal cross-lane flow)', () => {
    // A Z-shaped cross-lane flow: source in lane A (midY=200), target in lane B (midY=360).
    // The 4-point path has ALL orthogonal segments (H→V→H) and must survive the pass unchanged.
    //
    // Layout:
    //   lane A: source (100,160) 100×80  → right edge at x=200, midY=200
    //   lane B: target (400,320) 100×80  → left  edge at x=400, midY=360
    //
    // Z-shape waypoints (all segments orthogonal):
    //   (200,200) → (300,200)   horizontal
    //   (300,200) → (300,360)   vertical   ← the cross-lane drop
    //   (300,360) → (400,360)   horizontal
    //
    // Guard: isFullyOrthogonal must recognise this as orthogonal so it is skipped.
    const conn = makeForwardConn(
      { x: 100, y: 160, width: 100, height: 80 }, // lane A — midY=200
      { x: 400, y: 320, width: 100, height: 80 }, // lane B — midY=360
      [
        { x: 200, y: 200 },
        { x: 300, y: 200 }, // horizontal segment (same Y)
        { x: 300, y: 360 }, // vertical segment (lane drop)
        { x: 400, y: 360 }, // horizontal segment (same Y)
      ]
    );
    const originalWps = conn.waypoints.map((wp: any) => ({ ...wp }));

    const count = straightenNonOrthogonalFlows([conn]);

    // Must NOT be counted as needing straightening — it is already orthogonal
    expect(count).toBe(0);
    // Waypoints must be identical to the original Z-shape
    expect(conn.waypoints).toEqual(originalWps);
  });

  test('processes multiple connections, returning total count', () => {
    const conn1 = makeForwardConn(
      { x: 100, y: 160, width: 100, height: 80 },
      { x: 400, y: 160, width: 100, height: 80 },
      [
        { x: 200, y: 200 },
        { x: 250, y: 205 },
        { x: 400, y: 200 },
      ] // diagonal
    );
    const conn2 = makeForwardConn(
      { x: 500, y: 160, width: 100, height: 80 },
      { x: 800, y: 160, width: 100, height: 80 },
      [
        { x: 600, y: 200 },
        { x: 800, y: 200 },
      ] // already 2-point straight
    );
    const conn3 = makeForwardConn(
      { x: 900, y: 160, width: 100, height: 80 },
      { x: 1200, y: 240, width: 100, height: 80 },
      [
        { x: 1000, y: 200 },
        { x: 1050, y: 230 },
        { x: 1200, y: 280 },
      ] // diagonal
    );

    const count = straightenNonOrthogonalFlows([conn1, conn2, conn3]);

    expect(count).toBe(2); // conn1 and conn3 were non-orthogonal
    assertOrthogonal(conn1.waypoints, 'conn1');
    assertOrthogonal(conn3.waypoints, 'conn3');
  });
});

// ── Integration tests (through handleLayoutDiagram) ────────────────────────

describe('straightenFlows — integration via handleLayoutDiagram', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('labelsOnly+straightenFlows: fixes non-orthogonal waypoints without moving elements', async () => {
    const diagramId = await createDiagram('Straighten Integration');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const f1 = await connect(diagramId, start, task);
    const f2 = await connect(diagramId, task, end);

    // Run full layout first to get stable element positions
    await handleLayoutDiagram({ diagramId });

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;
    const modeling = diagram.modeler.get('modeling') as any;

    // Capture element positions (should not change with labelsOnly)
    const taskEl = reg.get(task);
    const positionBefore = { x: taskEl.x, y: taskEl.y };

    // Corrupt a connection to be non-orthogonal (Z-shaped)
    const conn = reg.get(f1);
    const src = conn.source;
    const tgt = conn.target;
    modeling.updateWaypoints(conn, [
      { x: src.x + src.width, y: src.y + src.height / 2 },
      { x: src.x + src.width + 30, y: src.y + src.height / 2 + 15 }, // diagonal!
      { x: tgt.x, y: tgt.y + tgt.height / 2 },
    ]);

    // Verify the corruption is in place (diagonal segment)
    const corruptedWps = reg.get(f1).waypoints;
    const dx = Math.abs(corruptedWps[1].x - corruptedWps[0].x);
    const dy = Math.abs(corruptedWps[1].y - corruptedWps[0].y);
    expect(dx > 1 && dy > 1).toBe(true); // confirms it IS diagonal

    // Run labelsOnly + straightenFlows (no full rebuild)
    const result = parseResult(
      await handleLayoutDiagram({ diagramId, labelsOnly: true, straightenFlows: true })
    );

    // Element positions unchanged
    const taskAfter = reg.get(task);
    expect(taskAfter.x).toBe(positionBefore.x);
    expect(taskAfter.y).toBe(positionBefore.y);

    // The connection is now orthogonal
    const fixedWps: Array<{ x: number; y: number }> = reg.get(f1).waypoints;
    assertOrthogonal(fixedWps, 'f1 after straighten');

    // Result reports count
    expect(result.straightenedFlowCount).toBeGreaterThanOrEqual(1);
    void f2; // suppress unused warning
  });

  test('labelsOnly without explicit straightenFlows: DOES fix non-orthogonal waypoints (always-on default)', async () => {
    const diagramId = await createDiagram('Default Straighten');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const f1 = await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    await handleLayoutDiagram({ diagramId });

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;
    const modeling = diagram.modeler.get('modeling') as any;

    // Corrupt a connection
    const conn = reg.get(f1);
    const src = conn.source;
    const tgt = conn.target;
    modeling.updateWaypoints(conn, [
      { x: src.x + src.width, y: src.y + src.height / 2 },
      { x: src.x + src.width + 30, y: src.y + src.height / 2 + 15 }, // diagonal!
      { x: tgt.x, y: tgt.y + tgt.height / 2 },
    ]);

    // labelsOnly with default straightenFlows (true)
    const result = parseResult(await handleLayoutDiagram({ diagramId, labelsOnly: true }));

    // Waypoints should now be orthogonal (default always-on)
    const fixedWps: Array<{ x: number; y: number }> = reg.get(f1).waypoints;
    assertOrthogonal(fixedWps, 'f1 after default-on straighten');
    expect(result.straightenedFlowCount).toBeGreaterThanOrEqual(1);
  });

  test('labelsOnly with straightenFlows: false: does NOT fix non-orthogonal waypoints', async () => {
    const diagramId = await createDiagram('No Straighten');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const f1 = await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    await handleLayoutDiagram({ diagramId });

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;
    const modeling = diagram.modeler.get('modeling') as any;

    // Corrupt a connection
    const conn = reg.get(f1);
    const src = conn.source;
    const tgt = conn.target;
    modeling.updateWaypoints(conn, [
      { x: src.x + src.width, y: src.y + src.height / 2 },
      { x: src.x + src.width + 30, y: src.y + src.height / 2 + 15 }, // diagonal!
      { x: tgt.x, y: tgt.y + tgt.height / 2 },
    ]);

    // labelsOnly WITH explicit straightenFlows: false (opt-out)
    await handleLayoutDiagram({ diagramId, labelsOnly: true, straightenFlows: false });

    // Waypoints should STILL be non-orthogonal (unchanged — explicitly disabled)
    const wps: Array<{ x: number; y: number }> = reg.get(f1).waypoints;
    const dx = Math.abs(wps[1].x - wps[0].x);
    const dy = Math.abs(wps[1].y - wps[0].y);
    expect(dx > 1 && dy > 1).toBe(true); // still diagonal — not fixed
  });

  test('full layout + straightenFlows: quality metrics improve for manually-corrupted diagram', async () => {
    const diagramId = await createDiagram('Full Layout Straighten');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:Task', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:Task', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, t1);
    const f2 = await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    // First layout to get stable positions
    await handleLayoutDiagram({ diagramId });

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;
    const modeling = diagram.modeler.get('modeling') as any;

    // Corrupt connection f2 with a diagonal
    const conn = reg.get(f2);
    const src = conn.source;
    const tgt = conn.target;
    modeling.updateWaypoints(conn, [
      { x: src.x + src.width, y: src.y + src.height / 2 },
      { x: (src.x + src.width + tgt.x) / 2, y: src.y + src.height / 2 + 20 }, // diagonal
      { x: tgt.x, y: tgt.y + tgt.height / 2 },
    ]);

    // Full layout with straightenFlows
    const result = parseResult(await handleLayoutDiagram({ diagramId, straightenFlows: true }));

    // Quality metrics should show 100% orthogonal
    expect(result.qualityMetrics.orthogonalFlowPercent).toBe(100);
  });

  test('straightenFlows in schema: included in tool definition', async () => {
    const { TOOL_DEFINITION } = await import('../../../src/handlers/layout/layout-diagram-schema');
    const props = (TOOL_DEFINITION.inputSchema as any).properties;
    expect(props).toHaveProperty('straightenFlows');
    expect(props.straightenFlows.type).toBe('boolean');
  });
});
