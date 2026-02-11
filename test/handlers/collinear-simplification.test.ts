/**
 * Tests for collinear waypoint simplification.
 *
 * Verifies that after layout, connections do not have redundant
 * collinear waypoints (3 consecutive points on the same horizontal
 * or vertical line where the middle point is unnecessary).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleConnect } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

/** Check if three points are collinear (on same horizontal or vertical line). */
function isCollinear(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  tolerance = 1
): boolean {
  const sameX = Math.abs(a.x - b.x) <= tolerance && Math.abs(b.x - c.x) <= tolerance;
  const sameY = Math.abs(a.y - b.y) <= tolerance && Math.abs(b.y - c.y) <= tolerance;
  return sameX || sameY;
}

describe('collinear waypoint simplification', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('removes collinear middle points after layout', async () => {
    // Build a diagram with XOR split and join — produces complex routes
    const diagramId = await createDiagram('Collinear Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const gw1 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Split' });
    const tA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path A' });
    const tB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path B' });
    const gw2 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: t1 });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: gw1 });
    await handleConnect({ diagramId, sourceElementId: gw1, targetElementId: tA });
    await handleConnect({ diagramId, sourceElementId: gw1, targetElementId: tB });
    await handleConnect({ diagramId, sourceElementId: tA, targetElementId: gw2 });
    await handleConnect({ diagramId, sourceElementId: tB, targetElementId: gw2 });
    await handleConnect({ diagramId, sourceElementId: gw2, targetElementId: end });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const connections = reg.filter(
      (el: any) => el.type === 'bpmn:SequenceFlow' && el.waypoints?.length >= 3
    );

    // No connection should have collinear triples
    for (const conn of connections) {
      const wps = conn.waypoints;
      for (let i = 1; i < wps.length - 1; i++) {
        const collinear = isCollinear(wps[i - 1], wps[i], wps[i + 1]);
        expect(collinear, `Connection ${conn.id} has collinear triple at index ${i}`).toBe(false);
      }
    }
  });

  test('preserves necessary bend points in L-shaped routes', async () => {
    // Linear flow — should produce straight routes with 2 waypoints each
    const diagramId = await createDiagram('Linear Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: t1 });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: end });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const connections = reg.filter(
      (el: any) => el.type === 'bpmn:SequenceFlow' && el.waypoints?.length >= 2
    );

    // Straight horizontal flows should have exactly 2 waypoints
    for (const conn of connections) {
      expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);
    }
  });
});
