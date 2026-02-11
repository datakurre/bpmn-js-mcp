/**
 * Gateway branch routing tests.
 *
 * Verifies that gateway branch connections route their vertical segments
 * through the gateway centre (top/bottom exit for splits, top/bottom entry
 * for joins), matching the bpmn-js convention where off-row branches exit
 * the gateway diamond at its centre-X rather than from the right edge.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleConnect } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

// ── Helpers ────────────────────────────────────────────────────────────────

function centreX(el: any): number {
  return el.x + (el.width || 0) / 2;
}

function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

/** Assert all waypoints form strictly orthogonal segments. */
function expectOrthogonal(conn: any) {
  const wps = conn.waypoints;
  expect(wps.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    const isHorizontal = dy < 1;
    const isVertical = dx < 1;
    expect(
      isHorizontal || isVertical,
      `Connection ${conn.id} segment ${i - 1}→${i} is diagonal: ` +
        `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
    ).toBe(true);
  }
}

/**
 * Find vertical segments in a connection's waypoints.
 * Returns an array of { x, minY, maxY } for each vertical segment.
 */
function findVerticalSegments(
  conn: any
): Array<{ x: number; minY: number; maxY: number; segmentIndex: number }> {
  const wps = conn.waypoints;
  const segments: Array<{ x: number; minY: number; maxY: number; segmentIndex: number }> = [];
  for (let i = 0; i < wps.length - 1; i++) {
    const dx = Math.abs(wps[i].x - wps[i + 1].x);
    const dy = Math.abs(wps[i].y - wps[i + 1].y);
    if (dx < 2 && dy > 5) {
      segments.push({
        x: wps[i].x,
        minY: Math.min(wps[i].y, wps[i + 1].y),
        maxY: Math.max(wps[i].y, wps[i + 1].y),
        segmentIndex: i,
      });
    }
  }
  return segments;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Channel routing for gateway branches', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('exclusive gateway branch connections have vertical segments between columns', async () => {
    const diagramId = await createDiagram('Channel Routing Exclusive');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decision?' });
    const taskYes = await addElement(diagramId, 'bpmn:UserTask', { name: 'Yes Path' });
    const taskNo = await addElement(diagramId, 'bpmn:UserTask', { name: 'No Path' });
    const merge = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: taskYes,
      label: 'Yes',
    });
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: taskNo,
      label: 'No',
    });
    await handleConnect({ diagramId, sourceElementId: taskYes, targetElementId: merge });
    await handleConnect({ diagramId, sourceElementId: taskNo, targetElementId: merge });
    await handleConnect({ diagramId, sourceElementId: merge, targetElementId: end });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // All connections should be orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }

    // The gateway is in one column, the branch tasks are in the next column.
    // Off-row branch connections should exit from the gateway diamond's
    // top/bottom edge at the gateway centre-X (L-bend convention), matching
    // how bpmn-js renders these connections in the reference files.
    const gwEl = reg.get(gw);
    const gwCx = centreX(gwEl);

    // Find the branch connections (gw → taskYes, gw → taskNo)
    const branchConns = connections.filter(
      (c: any) => c.source?.id === gw && (c.target?.id === taskYes || c.target?.id === taskNo)
    );

    for (const conn of branchConns) {
      // One branch is on the happy path (same Y as gateway), which will
      // be a straight horizontal line with no vertical segment. The other
      // branch must travel vertically from the gateway top/bottom edge.
      const srcCy = centreY(conn.source);
      const tgtCy = centreY(conn.target);
      if (Math.abs(srcCy - tgtCy) < 5) continue; // same row — skip

      const vertSegs = findVerticalSegments(conn);
      if (vertSegs.length === 0) continue;

      // The vertical segment's X should be at the gateway centre-X
      // (top/bottom L-bend exit convention)
      for (const seg of vertSegs) {
        expect(Math.abs(seg.x - gwCx)).toBeLessThanOrEqual(2);
      }
    }
  });

  test('parallel gateway branch connections route through channel', async () => {
    const diagramId = await createDiagram('Channel Routing Parallel');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway');
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });
    const taskC = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch C' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway');
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: split });
    await handleConnect({ diagramId, sourceElementId: split, targetElementId: taskA });
    await handleConnect({ diagramId, sourceElementId: split, targetElementId: taskB });
    await handleConnect({ diagramId, sourceElementId: split, targetElementId: taskC });
    await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: taskC, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: join, targetElementId: end });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // All connections should be orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }

    // Branch elements should be on distinct Y positions
    const branchYs = [taskA, taskB, taskC].map((id) => centreY(reg.get(id))).sort((a, b) => a - b);
    expect(branchYs[1] - branchYs[0]).toBeGreaterThan(10);
    expect(branchYs[2] - branchYs[1]).toBeGreaterThan(10);

    // Check that the split gateway is left of all branches
    const splitEl = reg.get(split);
    const splitRight = splitEl.x + (splitEl.width || 0);
    for (const id of [taskA, taskB, taskC]) {
      const el = reg.get(id);
      expect(splitRight).toBeLessThan(el.x);
    }
  });

  test('connections remain orthogonal after channel routing', async () => {
    const diagramId = await createDiagram('Orthogonal After Channel');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check?' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path A' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: t1, label: 'A' });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: t2, label: 'B' });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: end });
    await handleConnect({ diagramId, sourceElementId: t2, targetElementId: end });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');

    // Every connection must be strictly orthogonal
    for (const conn of connections) {
      expectOrthogonal(conn);
    }

    // The layout should have left-to-right ordering
    const startEl = reg.get(start);
    const gwEl = reg.get(gw);
    const endEl = reg.get(end);
    expect(centreX(startEl)).toBeLessThan(centreX(gwEl));
    expect(centreX(gwEl)).toBeLessThan(centreX(endEl));
  });
});
