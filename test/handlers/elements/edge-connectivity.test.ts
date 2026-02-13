/**
 * Tests for the fixDisconnectedEdges repair pass.
 *
 * Verifies that after layout, edge endpoints connect to their source
 * and target elements (no disconnected waypoints from gridSnap drift).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

/** Centre-Y of an element. */
function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

/** Check if a point is near an element (within threshold). */
function isNearElement(point: { x: number; y: number }, el: any, threshold: number): boolean {
  const cx = el.x + (el.width || 0) / 2;
  const cy = el.y + (el.height || 0) / 2;
  const hw = (el.width || 0) / 2 + threshold;
  const hh = (el.height || 0) / 2 + threshold;
  return Math.abs(point.x - cx) <= hw && Math.abs(point.y - cy) <= hh;
}

describe('edge endpoint connectivity after layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('all edges connect to their source and target after layout', async () => {
    // Build a diagram with XOR split and join
    const diagramId = await createDiagram('Edge Connect Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const gw1 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Split' });
    const tA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path A' });
    const tB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path B' });
    const gw2 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, gw1);
    await connect(diagramId, gw1, tA);
    await connect(diagramId, gw1, tB);
    await connect(diagramId, tA, gw2);
    await connect(diagramId, tB, gw2);
    await connect(diagramId, gw2, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const connections = reg.filter(
      (el: any) => el.type === 'bpmn:SequenceFlow' && el.waypoints?.length >= 2
    );

    // Every connection's first waypoint should be near its source
    // and last waypoint should be near its target
    const threshold = 25; // px tolerance
    for (const conn of connections) {
      const src = conn.source;
      const tgt = conn.target;
      const first = conn.waypoints[0];
      const last = conn.waypoints[conn.waypoints.length - 1];

      expect(
        isNearElement(first, src, threshold),
        `Connection ${conn.id}: first waypoint (${first.x},${first.y}) ` +
          `too far from source ${src.id} (${src.x},${src.y})`
      ).toBe(true);

      expect(
        isNearElement(last, tgt, threshold),
        `Connection ${conn.id}: last waypoint (${last.x},${last.y}) ` +
          `too far from target ${tgt.id} (${tgt.x},${tgt.y})`
      ).toBe(true);
    }
  });

  test('straight sequential flows have 2-point waypoints', async () => {
    const diagramId = await createDiagram('Straight Flow Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // All elements on the same row
    const startEl = reg.get(start);
    const t1El = reg.get(t1);
    const endEl = reg.get(end);
    expect(Math.abs(centreY(startEl) - centreY(t1El))).toBeLessThan(5);
    expect(Math.abs(centreY(t1El) - centreY(endEl))).toBeLessThan(5);

    // Straight flows should have exactly 2 waypoints
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expect(conn.waypoints.length).toBeLessThanOrEqual(2);
    }
  });
});
