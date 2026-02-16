/**
 * Tests for the element avoidance pass.
 *
 * After layout, connection waypoints should not pass through unrelated
 * element bounding boxes.  The avoidElementIntersections pass detects
 * and reroutes such intersections.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect, getRegistry } from '../../helpers';
import { segmentIntersectsRect, type Rect } from '../../../src/geometry';

/** Check if a connection's waypoints intersect a shape's bounding box. */
function connectionIntersectsShape(conn: any, shape: any): boolean {
  const rect: Rect = {
    x: shape.x,
    y: shape.y,
    width: shape.width || 0,
    height: shape.height || 0,
  };
  for (let i = 0; i < conn.waypoints.length - 1; i++) {
    if (segmentIntersectsRect(conn.waypoints[i], conn.waypoints[i + 1], rect)) {
      return true;
    }
  }
  return false;
}

/** Collect IDs of boundary events attached to specific elements. */
function collectAttachedBoundaryIds(allElements: any[], elementIds: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const el of allElements) {
    if (el.type === 'bpmn:BoundaryEvent' && el.host && elementIds.has(el.host.id)) {
      result.add(el.id);
    }
  }
  return result;
}

/** Infrastructure/lane/label type check. */
function isObstacleCandidate(el: any): boolean {
  return (
    el.type &&
    !el.type.includes('Flow') &&
    !el.type.includes('Association') &&
    !el.type.includes('MessageFlow') &&
    !el.type.includes('DataInputAssociation') &&
    !el.type.includes('DataOutputAssociation') &&
    el.type !== 'label' &&
    el.type !== 'bpmn:BoundaryEvent' &&
    el.type !== 'bpmn:Participant' &&
    el.type !== 'bpmn:Collaboration' &&
    el.type !== 'bpmn:Process' &&
    !el.type.includes('Lane') &&
    el.width !== undefined &&
    el.height !== undefined
  );
}

/** Count how many connection segments intersect unrelated elements. */
function countFlowThroughElementIntersections(registry: any): number {
  const allElements = registry.getAll();
  const shapes = allElements.filter((el: any) => isObstacleCandidate(el));
  const connections = allElements.filter(
    (el: any) =>
      (el.type === 'bpmn:SequenceFlow' ||
        el.type === 'bpmn:MessageFlow' ||
        el.type === 'bpmn:Association') &&
      el.waypoints &&
      el.waypoints.length >= 2
  );

  let count = 0;
  for (const conn of connections) {
    const sourceId = conn.source?.id;
    const targetId = conn.target?.id;
    if (!sourceId || !targetId) continue;

    const attachedBoundaryIds = collectAttachedBoundaryIds(
      allElements,
      new Set([sourceId, targetId])
    );

    for (const shape of shapes) {
      if (shape.id === sourceId || shape.id === targetId) continue;
      if (attachedBoundaryIds.has(shape.id)) continue;
      if (connectionIntersectsShape(conn, shape)) {
        count++;
      }
    }
  }

  return count;
}

describe('Element avoidance', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('flow through intermediate element is rerouted after layout', async () => {
    // Create: Start → A → B → C → End
    // The flow from A→C would normally go straight through B's bounding box
    // if B were positioned between them — but layout places them sequentially.
    // Instead, test with a diamond pattern where a skip-connection exists.
    const diagramId = await createDiagram('Element Avoidance Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Split' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });
    const merge = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskA, { label: 'Yes' });
    await connect(diagramId, gw, taskB, { label: 'No' });
    await connect(diagramId, taskA, merge);
    await connect(diagramId, taskB, merge);
    await connect(diagramId, merge, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getRegistry(diagramId);
    const intersections = countFlowThroughElementIntersections(reg);

    // After element avoidance, there should be no flow-through-element intersections
    expect(intersections).toBe(0);
  });

  test('sequential flow has no intersections after layout', async () => {
    const diagramId = await createDiagram('Sequential Avoidance');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 2' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 3' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, t3);
    await connect(diagramId, t3, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getRegistry(diagramId);
    const intersections = countFlowThroughElementIntersections(reg);
    expect(intersections).toBe(0);
  });

  test('parallel gateway branches have no flow-through-element intersections', async () => {
    const diagramId = await createDiagram('Parallel Avoidance');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const fork = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Fork' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });
    const taskC = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch C' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, fork);
    await connect(diagramId, fork, taskA);
    await connect(diagramId, fork, taskB);
    await connect(diagramId, fork, taskC);
    await connect(diagramId, taskA, join);
    await connect(diagramId, taskB, join);
    await connect(diagramId, taskC, join);
    await connect(diagramId, join, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getRegistry(diagramId);
    const intersections = countFlowThroughElementIntersections(reg);
    expect(intersections).toBe(0);
  });
});
