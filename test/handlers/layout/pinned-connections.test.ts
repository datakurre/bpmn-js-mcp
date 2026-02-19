import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { handleSetConnectionWaypoints } from '../../../src/handlers/elements/set-connection-waypoints';
import {
  parseResult,
  createDiagram,
  addElement,
  connect,
  clearDiagrams,
  getRegistry,
} from '../../helpers';

describe('user-pinned connection waypoints', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('set_bpmn_connection_waypoints marks the connection as pinned', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const flow1 = await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const registry = getRegistry(diagramId);
    const conn = registry.get(flow1);
    const customWaypoints = [
      { x: conn.source.x + conn.source.width, y: conn.source.y + 20 },
      { x: conn.target.x, y: conn.source.y + 20 },
    ];

    const res = parseResult(
      await handleSetConnectionWaypoints({
        diagramId,
        connectionId: flow1,
        waypoints: customWaypoints,
      })
    );

    expect(res.success).toBe(true);
    expect(res.pinned).toBe(true);

    // Verify the connection is in the pinned set
    const { getDiagram } = await import('../../../src/diagram-manager');
    const diagram = getDiagram(diagramId)!;
    expect(diagram.pinnedConnections).toBeDefined();
    expect(diagram.pinnedConnections!.has(flow1)).toBe(true);
  });

  test('full layout restores pinned connection waypoints and clears pin state', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const flow1 = await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    // First, run layout to get valid positions
    await handleLayoutDiagram({ diagramId });

    const registry = getRegistry(diagramId);
    const conn = registry.get(flow1);

    // Set custom waypoints that deviate from the auto-route
    const customWaypoints = [
      { x: Math.round(conn.source.x + conn.source.width), y: 350 },
      { x: Math.round(conn.target.x), y: 350 },
    ];

    await handleSetConnectionWaypoints({
      diagramId,
      connectionId: flow1,
      waypoints: customWaypoints,
    });

    // Verify waypoints are set
    const connBefore = registry.get(flow1);
    expect(connBefore.waypoints[0].y).toBe(350);
    expect(connBefore.waypoints[connBefore.waypoints.length - 1].y).toBe(350);

    // Run full layout again — should preserve the pinned waypoints
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Connection waypoints should be restored to the custom values
    const connAfter = registry.get(flow1);
    expect(connAfter.waypoints[0].y).toBe(350);
    expect(connAfter.waypoints[connAfter.waypoints.length - 1].y).toBe(350);

    // Full layout clears the pin state
    const { getDiagram } = await import('../../../src/diagram-manager');
    const diagram = getDiagram(diagramId)!;
    expect(diagram.pinnedConnections).toBeUndefined();
  });

  test('pinned waypoints survive partial layout', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:Task', { name: 'T1' });
    const task2 = await addElement(diagramId, 'bpmn:Task', { name: 'T2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const flow1 = await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, end);

    // Run full layout first
    await handleLayoutDiagram({ diagramId });

    const registry = getRegistry(diagramId);
    const conn = registry.get(flow1);

    // Pin custom waypoints for flow1
    const customY = 500;
    const customWaypoints = [
      { x: Math.round(conn.source.x + conn.source.width), y: customY },
      { x: Math.round(conn.target.x), y: customY },
    ];
    await handleSetConnectionWaypoints({
      diagramId,
      connectionId: flow1,
      waypoints: customWaypoints,
    });

    // Run partial layout on task2 only
    const res = parseResult(await handleLayoutDiagram({ diagramId, elementIds: [task2] }));
    expect(res.success).toBe(true);

    // flow1 is not in the subset — its pinned waypoints should still be intact
    const connAfter = registry.get(flow1);
    expect(connAfter.waypoints[0].y).toBe(customY);
    expect(connAfter.waypoints[connAfter.waypoints.length - 1].y).toBe(customY);

    // Pin state should still be set (partial layout doesn't clear pins)
    const { getDiagram } = await import('../../../src/diagram-manager');
    const diagram = getDiagram(diagramId)!;
    expect(diagram.pinnedConnections?.has(flow1)).toBe(true);
  });

  test('calling set_bpmn_connection_waypoints again updates pin to new waypoints', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const flow1 = await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    await handleLayoutDiagram({ diagramId });

    const registry = getRegistry(diagramId);
    const conn = registry.get(flow1);

    // Set first custom waypoints
    await handleSetConnectionWaypoints({
      diagramId,
      connectionId: flow1,
      waypoints: [
        { x: Math.round(conn.source.x + conn.source.width), y: 300 },
        { x: Math.round(conn.target.x), y: 300 },
      ],
    });

    // Set second custom waypoints (overwriting the first pin)
    await handleSetConnectionWaypoints({
      diagramId,
      connectionId: flow1,
      waypoints: [
        { x: Math.round(conn.source.x + conn.source.width), y: 400 },
        { x: Math.round(conn.target.x), y: 400 },
      ],
    });

    // Verify the second waypoints are active
    const connNow = registry.get(flow1);
    expect(connNow.waypoints[0].y).toBe(400);

    // Run full layout — should restore the second pin
    await handleLayoutDiagram({ diagramId });
    const connAfter = registry.get(flow1);
    expect(connAfter.waypoints[0].y).toBe(400);
  });
});
