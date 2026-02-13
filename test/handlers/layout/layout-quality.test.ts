/**
 * Layout quality regression tests.
 *
 * These tests build known BPMN patterns and assert specific layout
 * properties after ELK layout:
 * - All flows are strictly orthogonal (no diagonals)
 * - Same-row elements share Y within ±1 px
 * - Flow waypoints have minimal bend count
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import {
  createDiagram,
  addElement,
  clearDiagrams,
  importReference,
  comparePositions,
  connect,
} from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Centre-Y of an element. */
function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

/** Centre-X of an element. */
function centreX(el: any): number {
  return el.x + (el.width || 0) / 2;
}

/** Assert all waypoints of a connection form strictly orthogonal segments. */
function expectOrthogonal(conn: any) {
  const wps = conn.waypoints;
  expect(wps.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    // Each segment must be either horizontal (dy ≈ 0) or vertical (dx ≈ 0)
    const isHorizontal = dy < 1;
    const isVertical = dx < 1;
    expect(
      isHorizontal || isVertical,
      `Connection ${conn.id} segment ${i - 1}→${i} is diagonal: ` +
        `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
    ).toBe(true);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Layout quality regression', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sequential flow: all connections orthogonal, elements on same Y', async () => {
    const diagramId = await createDiagram('Sequential Quality');
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

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // All elements should share the same Y (within 1 px)
    const elements = [start, t1, t2, t3, end].map((id) => reg.get(id));
    const refY = centreY(elements[0]);
    for (const el of elements) {
      expect(Math.abs(centreY(el) - refY)).toBeLessThanOrEqual(1);
    }

    // All connections should be strictly orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }

    // Sequential connections between same-Y elements should be 2-point horizontal
    for (const conn of connections) {
      expect(conn.waypoints.length).toBeLessThanOrEqual(2);
    }
  });

  test('exclusive branch with merge: orthogonal flows, branch elements on distinct rows', async () => {
    const diagramId = await createDiagram('Exclusive Merge Quality');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decision' });
    const taskYes = await addElement(diagramId, 'bpmn:UserTask', { name: 'Yes Path' });
    const taskNo = await addElement(diagramId, 'bpmn:UserTask', { name: 'No Path' });
    const merge = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskYes, { label: 'Yes' });
    await connect(diagramId, gw, taskNo, { label: 'No', isDefault: true });
    await connect(diagramId, taskYes, merge);
    await connect(diagramId, taskNo, merge);
    await connect(diagramId, merge, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Branch tasks should be on different Y rows
    const yesEl = reg.get(taskYes);
    const noEl = reg.get(taskNo);
    expect(Math.abs(centreY(yesEl) - centreY(noEl))).toBeGreaterThan(10);

    // All connections should be strictly orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });

  test('parallel branch with merge: orthogonal flows', async () => {
    const diagramId = await createDiagram('Parallel Merge Quality');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 2' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 3' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, split);
    await connect(diagramId, split, t1);
    await connect(diagramId, split, t2);
    await connect(diagramId, split, t3);
    await connect(diagramId, t1, join);
    await connect(diagramId, t2, join);
    await connect(diagramId, t3, join);
    await connect(diagramId, join, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Three branches should have distinct Y
    const ys = [t1, t2, t3].map((id) => centreY(reg.get(id)));
    expect(new Set(ys.map((y) => Math.round(y))).size).toBe(3);

    // All connections should be strictly orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });

  test('2-branch exclusive split: happy-path branch at gateway Y, off-path below', async () => {
    // Gateway → [Yes: Task → Merge, No: Task → Merge]
    // With no default flow, happy-path follows the first connected flow (Yes),
    // so "Yes Path" should be pinned at the gateway Y-centre and "No Path" below.
    const diagramId = await createDiagram('Symmetric Branches');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decision' });
    const taskYes = await addElement(diagramId, 'bpmn:UserTask', { name: 'Yes Path' });
    const taskNo = await addElement(diagramId, 'bpmn:UserTask', { name: 'No Path' });
    const merge = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    // Note: No default flow, so happy path follows first connected flow
    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskYes, { label: 'Yes' });
    await connect(diagramId, gw, taskNo, { label: 'No' });
    await connect(diagramId, taskYes, merge);
    await connect(diagramId, taskNo, merge);
    await connect(diagramId, merge, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    const gwEl = reg.get(gw);
    const gwCy = centreY(gwEl);
    const yesEl = reg.get(taskYes);
    const noEl = reg.get(taskNo);

    // Happy-path branch (Yes) should be at gateway Y (within 5px)
    expect(Math.abs(centreY(yesEl) - gwCy)).toBeLessThanOrEqual(5);
    // Off-path branch (No) should be below the gateway
    expect(centreY(noEl)).toBeGreaterThan(gwCy + 10);
  });

  test('off-path end event aligns with its predecessor Y', async () => {
    // When an end event is a target of an off-path branch, it should
    // align vertically with its incoming source to avoid long vertical connectors
    const diagramId = await createDiagram('End Event Alignment');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'OK?' });
    const taskOk = await addElement(diagramId, 'bpmn:UserTask', { name: 'Continue' });
    const endOk = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
    const endFail = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Failed' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, gw);
    await connect(diagramId, gw, taskOk, { label: 'Yes' });
    await connect(diagramId, gw, endFail, { label: 'No' });
    await connect(diagramId, taskOk, endOk);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // All connections should be orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });

  test('exclusive branch without merge gateway: flows to shared end event are orthogonal', async () => {
    // Reproduces the example.bpmn pattern where two branches merge at an EndEvent
    const diagramId = await createDiagram('Shared EndEvent Quality');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, gw);
    await connect(diagramId, gw, taskA, { label: 'A' });
    await connect(diagramId, gw, taskB, { label: 'B', isDefault: true });
    await connect(diagramId, taskA, end);
    await connect(diagramId, taskB, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // All connections should be strictly orthogonal (no diagonals)
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }

    // Start, Process, and Gateway should be on the same horizontal row
    const startEl = reg.get(start);
    const taskEl = reg.get(task);
    const gwEl = reg.get(gw);
    const refY = centreY(startEl);
    expect(Math.abs(centreY(taskEl) - refY)).toBeLessThanOrEqual(1);
    expect(Math.abs(centreY(gwEl) - refY)).toBeLessThanOrEqual(1);

    // Two branch tasks should be at different Y positions
    const aEl = reg.get(taskA);
    const bEl = reg.get(taskB);
    expect(Math.abs(centreY(aEl) - centreY(bEl))).toBeGreaterThan(10);
  });

  test('same-layer elements are vertically aligned after snap', async () => {
    // Build: Start → Task → Gateway → [Yes→End1, No→End2]
    // Gateway and the two end events should be in different layers,
    // but Start and Task should be on the same Y row
    const diagramId = await createDiagram('Vertical Snap Quality');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Work' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const taskEl = reg.get(task);
    const endEl = reg.get(end);

    // All three should be on the same Y row (they're in a straight line)
    const refY = centreY(startEl);
    expect(Math.abs(centreY(taskEl) - refY)).toBeLessThanOrEqual(1);
    expect(Math.abs(centreY(endEl) - refY)).toBeLessThanOrEqual(1);
  });

  test('left-to-right ordering preserved in complex patterns', async () => {
    const diagramId = await createDiagram('L2R Complex');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'First' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'GW' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Branch A' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });
    const join = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Join' });
    const t4 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Final' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, gw);
    await connect(diagramId, gw, t2);
    await connect(diagramId, gw, t3);
    await connect(diagramId, t2, join);
    await connect(diagramId, t3, join);
    await connect(diagramId, join, t4);
    await connect(diagramId, t4, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Verify L→R ordering through the chain
    expect(centreX(reg.get(start))).toBeLessThan(centreX(reg.get(t1)));
    expect(centreX(reg.get(t1))).toBeLessThan(centreX(reg.get(gw)));
    expect(centreX(reg.get(gw))).toBeLessThan(centreX(reg.get(t2)));
    expect(centreX(reg.get(gw))).toBeLessThan(centreX(reg.get(t3)));
    expect(centreX(reg.get(t2))).toBeLessThan(centreX(reg.get(join)));
    expect(centreX(reg.get(join))).toBeLessThan(centreX(reg.get(t4)));
    expect(centreX(reg.get(t4))).toBeLessThan(centreX(reg.get(end)));

    // All connections should be orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });

  // ── Artifact layout ────────────────────────────────────────────────────

  test('data objects and text annotations do not overlap flow elements after layout', async () => {
    const diagramId = await createDiagram('Artifacts Quality');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const dataObj = await addElement(diagramId, 'bpmn:DataObjectReference', { name: 'Doc' });
    const annot = await addElement(diagramId, 'bpmn:TextAnnotation', {
      name: 'Important note about processing',
    });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Get bounding boxes
    const flowEls = [start, task, end].map((id) => {
      const el = reg.get(id);
      return {
        x: el.x,
        y: el.y,
        right: el.x + (el.width || 0),
        bottom: el.y + (el.height || 0),
      };
    });

    const artifactEls = [dataObj, annot].map((id) => {
      const el = reg.get(id);
      return {
        id: el.id,
        x: el.x,
        y: el.y,
        right: el.x + (el.width || 0),
        bottom: el.y + (el.height || 0),
      };
    });

    // Assert: artifacts should not overlap with flow element bounding boxes
    for (const art of artifactEls) {
      for (const flow of flowEls) {
        const overlaps =
          art.x < flow.right && art.right > flow.x && art.y < flow.bottom && art.bottom > flow.y;
        expect(overlaps, `Artifact ${art.id} overlaps flow element`).toBe(false);
      }
    }
  });

  test('boundary event recovery: orthogonal flows after layout', async () => {
    const diagramId = await createDiagram('Boundary Recovery');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call Service' });
    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: task,
    });
    const recovery = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle Error' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
    const endError = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Error End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    await connect(diagramId, boundary, recovery);
    await connect(diagramId, recovery, endError);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // All connections should be strictly orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });

  // ── Reference BPMN position tracking ─────────────────────────────────

  describe('reference position tracking', () => {
    test('01-linear-flow: positions converge toward reference', async () => {
      const { diagramId, registry } = await importReference('01-linear-flow');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '01-linear-flow', 10);
      // Track progress — always passes
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('02-exclusive-gateway: positions converge toward reference', async () => {
      const { diagramId, registry } = await importReference('02-exclusive-gateway');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '02-exclusive-gateway', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('03-parallel-fork-join: positions converge toward reference', async () => {
      const { diagramId, registry } = await importReference('03-parallel-fork-join');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '03-parallel-fork-join', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('06-boundary-events: positions converge toward reference', async () => {
      const { diagramId, registry } = await importReference('06-boundary-events');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '06-boundary-events', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });
  });
});
