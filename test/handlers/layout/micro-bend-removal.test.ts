/**
 * Tests for micro-bend removal and short-segment merging.
 *
 * Verifies that the edge straightening pass removes:
 * 1. Near-collinear waypoints that create small wiggles (micro-bends)
 * 2. Short orthogonal segments that create staircase patterns
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

/** Check if three consecutive points form a micro-bend (small deviation from straight line). */
function hasMicroBend(
  wps: Array<{ x: number; y: number }>,
  tolerance: number
): { found: boolean; index: number; deviation: number } {
  for (let i = 1; i < wps.length - 1; i++) {
    const prev = wps[i - 1];
    const curr = wps[i];
    const next = wps[i + 1];

    // Check near-horizontal: all Y within tolerance but not exactly collinear
    const allYClose =
      Math.abs(prev.y - curr.y) <= tolerance &&
      Math.abs(curr.y - next.y) <= tolerance &&
      Math.abs(prev.y - next.y) <= tolerance;

    // Check near-vertical: all X within tolerance but not exactly collinear
    const allXClose =
      Math.abs(prev.x - curr.x) <= tolerance &&
      Math.abs(curr.x - next.x) <= tolerance &&
      Math.abs(prev.x - next.x) <= tolerance;

    if (allYClose || allXClose) {
      const yDev = Math.max(Math.abs(prev.y - curr.y), Math.abs(curr.y - next.y));
      const xDev = Math.max(Math.abs(prev.x - curr.x), Math.abs(curr.x - next.x));
      const deviation = allYClose ? yDev : xDev;
      if (deviation > 1) {
        return { found: true, index: i, deviation };
      }
    }
  }
  return { found: false, index: -1, deviation: 0 };
}

/** Check for short orthogonal staircase segments. */
function hasShortStaircase(wps: Array<{ x: number; y: number }>, threshold: number): boolean {
  for (let i = 0; i < wps.length - 3; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    const c = wps[i + 2];
    const d = wps[i + 3];

    // H-V-H: horizontal → short vertical → horizontal
    if (Math.abs(a.y - b.y) <= 1 && Math.abs(b.x - c.x) <= 1 && Math.abs(c.y - d.y) <= 1) {
      const vLen = Math.abs(b.y - c.y);
      if (vLen > 0 && vLen <= threshold) return true;
    }

    // V-H-V: vertical → short horizontal → vertical
    if (Math.abs(a.x - b.x) <= 1 && Math.abs(b.y - c.y) <= 1 && Math.abs(c.x - d.x) <= 1) {
      const hLen = Math.abs(b.x - c.x);
      if (hLen > 0 && hLen <= threshold) return true;
    }
  }
  return false;
}

describe('micro-bend removal', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('layout produces no micro-bends (5px tolerance) in split-merge flow', async () => {
    // Build a diagram with XOR split and join — can produce micro-bends
    const diagramId = await createDiagram('Micro-bend Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });
    const gw1 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
    const tA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process A' });
    const tB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process B' });
    const gw2 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Finalize' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, gw1);
    await connect(diagramId, gw1, tA);
    await connect(diagramId, gw1, tB);
    await connect(diagramId, tA, gw2);
    await connect(diagramId, tB, gw2);
    await connect(diagramId, gw2, t2);
    await connect(diagramId, t2, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const connections = reg.filter(
      (el: any) => el.type === 'bpmn:SequenceFlow' && el.waypoints?.length >= 3
    );

    for (const conn of connections) {
      const wps = conn.waypoints;
      const result = hasMicroBend(wps, 5);
      expect(
        result.found,
        `Connection ${conn.id} has micro-bend at index ${result.index} (deviation: ${result.deviation}px)`
      ).toBe(false);
    }
  });

  test('layout produces no short staircases (6px) in parallel flow', async () => {
    // Build a parallel gateway pattern — can produce staircases
    const diagramId = await createDiagram('Staircase Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw1 = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Fork' });
    const tA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch A' });
    const tB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });
    const tC = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch C' });
    const gw2 = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw1);
    await connect(diagramId, gw1, tA);
    await connect(diagramId, gw1, tB);
    await connect(diagramId, gw1, tC);
    await connect(diagramId, tA, gw2);
    await connect(diagramId, tB, gw2);
    await connect(diagramId, tC, gw2);
    await connect(diagramId, gw2, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const connections = reg.filter(
      (el: any) => el.type === 'bpmn:SequenceFlow' && el.waypoints?.length >= 4
    );

    for (const conn of connections) {
      const wps = conn.waypoints;
      expect(
        hasShortStaircase(wps, 6),
        `Connection ${conn.id} has staircase pattern in waypoints: ${JSON.stringify(wps.map((w: any) => [w.x, w.y]))}`
      ).toBe(false);
    }
  });

  test('preserves intentional bends in L-shaped routes', async () => {
    // Linear flow with branch — should have intentional L-bends for off-row connections
    const diagramId = await createDiagram('Bend Preservation');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check?' });
    const tA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path A' });
    const tB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, tA);
    await connect(diagramId, gw, tB);
    await connect(diagramId, tA, end);
    await connect(diagramId, tB, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow' && el.waypoints);

    // All connections should have at least 2 waypoints (nothing removed too aggressively)
    for (const conn of connections) {
      expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);
    }

    // Off-row connections (gateway branches) should keep their L-shaped bends
    const offRowConns = connections.filter((conn: any) => {
      const srcCy = conn.source.y + (conn.source.height || 0) / 2;
      const tgtCy = conn.target.y + (conn.target.height || 0) / 2;
      return Math.abs(srcCy - tgtCy) > 20;
    });

    for (const conn of offRowConns) {
      // Off-row connections need at least 3 waypoints (L-bend or Z-shape)
      expect(
        conn.waypoints.length,
        `Off-row connection ${conn.id} should have ≥3 waypoints for its bend`
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
