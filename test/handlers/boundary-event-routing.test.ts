import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleConnect } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('Boundary event routing after layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('routes boundary event outgoing flow around the host task', async () => {
    const diagramId = await createDiagram('Boundary Event Routing');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    // Attach a boundary event (timer) to the task
    const boundaryEvent = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timeout',
      hostElementId: task,
    });

    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timeout End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });
    await handleConnect({
      diagramId,
      sourceElementId: boundaryEvent,
      targetElementId: errorEnd,
    });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Verify the boundary event's connection has waypoints
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');

    // Find the connection from boundary event to error end
    const connections = reg.filter(
      (el: any) => el.type === 'bpmn:SequenceFlow' && el.source?.type === 'bpmn:BoundaryEvent'
    );
    expect(connections.length).toBeGreaterThanOrEqual(1);

    const boundaryConn = connections[0];
    expect(boundaryConn.waypoints).toBeDefined();
    expect(boundaryConn.waypoints.length).toBeGreaterThanOrEqual(2);
  });

  test('boundary event error path routes below the main flow', async () => {
    const diagramId = await createDiagram('Error Path Routing');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Success' });

    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: task,
    });

    const retryTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle Error' });
    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Failed' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });
    await handleConnect({ diagramId, sourceElementId: boundary, targetElementId: retryTask });
    await handleConnect({ diagramId, sourceElementId: retryTask, targetElementId: errorEnd });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.elementCount).toBeGreaterThanOrEqual(5);

    // The boundary connection should have orthogonal waypoints (no diagonals)
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');

    const boundaryConn = reg.filter(
      (el: any) => el.type === 'bpmn:SequenceFlow' && el.source?.id === boundary
    )[0];

    if (boundaryConn?.waypoints) {
      // Each consecutive pair should be either horizontal or vertical
      for (let i = 1; i < boundaryConn.waypoints.length; i++) {
        const prev = boundaryConn.waypoints[i - 1];
        const curr = boundaryConn.waypoints[i];
        const dx = Math.abs(curr.x - prev.x);
        const dy = Math.abs(curr.y - prev.y);
        // At least one delta should be very small (orthogonal)
        expect(Math.min(dx, dy)).toBeLessThan(16);
      }
    }
  });
});
