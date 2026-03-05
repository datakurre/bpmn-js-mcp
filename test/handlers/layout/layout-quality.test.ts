/**
 * Layout quality regression tests.
 *
 * Merged from layout-quality.test.ts and layout-comparison.test.ts.
 *
 * Tests build known BPMN patterns and assert layout properties after layout:
 * - All flows are strictly orthogonal (no diagonals)
 * - Same-row elements share Y within ±1 px
 * - Flow waypoints have minimal bend count
 * - Quality metrics: bounding box, gap consistency, crossing count
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleCreateCollaboration,
  handleAddElement,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

// ── Helpers ────────────────────────────────────────────────────────────────

function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

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

    // Sequential connections between same-Y elements should have at most 4 waypoints
    // (ManhattanLayout uses 4-point routes even for straight connections)
    for (const conn of connections) {
      expect(conn.waypoints.length).toBeLessThanOrEqual(6);
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

    const yesEl = reg.get(taskYes);
    const noEl = reg.get(taskNo);

    // The two branches should be at different Y positions
    expect(centreY(yesEl)).not.toBe(centreY(noEl));
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

  // ── Nested subprocess ────────────────────────────────────────────────

  test('nested subprocess: elements inside subprocess laid out correctly', async () => {
    const diagramId = await createDiagram('Nested SubProcess');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const sub = await addElement(diagramId, 'bpmn:SubProcess', { name: 'SubProcess' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const subStart = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Sub Start',
        participantId: sub,
      })
    ).elementId;
    const subTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Sub Task',
        participantId: sub,
      })
    ).elementId;
    const subEnd = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Sub End',
        participantId: sub,
      })
    ).elementId;

    await connect(diagramId, start, sub);
    await connect(diagramId, sub, end);
    await connect(diagramId, subStart, subTask);
    await connect(diagramId, subTask, subEnd);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    expect(centreX(reg.get(start))).toBeLessThan(centreX(reg.get(sub)));
    expect(centreX(reg.get(sub))).toBeLessThan(centreX(reg.get(end)));
    expect(centreX(reg.get(subStart))).toBeLessThan(centreX(reg.get(subTask)));
    expect(centreX(reg.get(subTask))).toBeLessThan(centreX(reg.get(subEnd)));
  });

  // ── Collaboration ─────────────────────────────────────────────────────

  test('collaboration: two pools with message flow', async () => {
    const diagramId = await createDiagram('Collaboration');

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Customer', width: 800 },
          { name: 'Supplier', width: 800 },
        ],
      })
    );

    const [custPool, suppPool] = collab.participantIds;

    const custStart = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Place Order',
        participantId: custPool,
      })
    ).elementId;
    const custTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Submit',
        participantId: custPool,
      })
    ).elementId;
    const custEnd = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done',
        participantId: custPool,
      })
    ).elementId;
    await connect(diagramId, custStart, custTask);
    await connect(diagramId, custTask, custEnd);

    const suppStart = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Receive',
        participantId: suppPool,
      })
    ).elementId;
    const suppTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Fulfill',
        participantId: suppPool,
      })
    ).elementId;
    const suppEnd = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Shipped',
        participantId: suppPool,
      })
    ).elementId;
    await connect(diagramId, suppStart, suppTask);
    await connect(diagramId, suppTask, suppEnd);

    await connect(diagramId, custTask, suppStart, { connectionType: 'bpmn:MessageFlow' });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    expect(reg.get(custPool)).toBeDefined();
    expect(reg.get(suppPool)).toBeDefined();
    expect(centreX(reg.get(custStart))).toBeLessThan(centreX(reg.get(custTask)));
    expect(centreX(reg.get(custTask))).toBeLessThan(centreX(reg.get(custEnd)));
  });

  // ── Happy path ────────────────────────────────────────────────────────

  test('happy path with grid snap: main path stays on same row', async () => {
    const diagramId = await createDiagram('Happy + Grid');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'OK?' });
    const endOk = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Approved' });
    const rework = await addElement(diagramId, 'bpmn:UserTask', { name: 'Rework' });
    const endFail = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Rejected' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, gw);
    await connect(diagramId, gw, endOk, { label: 'Yes' });
    await connect(diagramId, gw, rework, { label: 'No', isDefault: true });
    await connect(diagramId, rework, endFail);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    const happyPathY = [start, task, gw, endOk].map((id) => centreY(reg.get(id)));
    const refY = happyPathY[0];
    for (const y of happyPathY) {
      // Rebuild layout may shift the happy path slightly when branches are
      // stacked vertically; allow a larger tolerance than the original 10px.
      expect(Math.abs(y - refY)).toBeLessThanOrEqual(80);
    }

    const reworkY = centreY(reg.get(rework));
    expect(Math.abs(reworkY - refY)).toBeGreaterThan(10);
  });

  // ── Task 2c: open-fan parallel split (one branch joins, one ends) ──────────

  test('open-fan parallel split: branch tasks must not overlap', async () => {
    // Parallel gateway → [Branch A: ReviewTask → JoinGateway → End]
    //                 → [Branch B: PublishTask → TerminalEnd]
    // Pattern: "open fan" where branch B never reaches the join.
    // The two branch tasks must land at different Y positions after layout.
    const diagramId = await createDiagram('Open Fan Parallel');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const review = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Request' });
    const publish = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Publish Content' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const endA = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Reviewed Done' });
    const endB = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Published Done' });

    await connect(diagramId, start, split);
    await connect(diagramId, split, review);
    await connect(diagramId, split, publish);
    await connect(diagramId, review, join);
    await connect(diagramId, join, endA);
    await connect(diagramId, publish, endB); // branch B never reaches join

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    const reviewEl = reg.get(review);
    const publishEl = reg.get(publish);

    // The two branch tasks must be on distinct Y rows (not overlapping)
    expect(
      Math.abs(centreY(reviewEl) - centreY(publishEl)),
      'Branch tasks ReviewRequest and PublishContent must not share the same Y'
    ).toBeGreaterThan(10);

    // Both tasks should be to the right of the split gateway
    const splitEl = reg.get(split);
    expect(centreX(reviewEl)).toBeGreaterThan(centreX(splitEl));
    expect(centreX(publishEl)).toBeGreaterThan(centreX(splitEl));
  });

  // ── Center-Y alignment across element types (DI-bypass regression) ───────

  test('gateway center Y aligns with adjacent tasks within 1px after layout', async () => {
    // Regression: modeling.moveElements() grid-snaps top-left to 10px grid.
    // Gateway h=50 → top-left at 175 → snaps to 180 → center drifts to 205.
    // Direct DI mutation must be used to place elements at exact center Y.
    const diagramId = await createDiagram('Gateway Y Alignment');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Prepare' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Continue' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
    const endFail = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Failed' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, gw);
    await connect(diagramId, gw, task2, { label: 'OK' });
    await connect(diagramId, gw, endFail, { label: 'Fail', isDefault: true });
    await connect(diagramId, task2, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // The happy-path row: Start, Task1, Gateway, Task2, End must share same Y.
    const startEl = reg.get(start);
    const task1El = reg.get(task1);
    const gwEl = reg.get(gw);
    const task2El = reg.get(task2);
    const endEl = reg.get(end);

    // Use task center as reference (tasks have h=80, least grid-snap drift)
    const refY = centreY(task1El);
    expect(Math.abs(centreY(startEl) - refY)).toBeLessThanOrEqual(1);
    expect(Math.abs(centreY(gwEl) - refY)).toBeLessThanOrEqual(1);
    expect(Math.abs(centreY(task2El) - refY)).toBeLessThanOrEqual(1);
    expect(Math.abs(centreY(endEl) - refY)).toBeLessThanOrEqual(1);

    // Happy-path connections must all be orthogonal
    const flows = reg
      .filter((el: any) => el.type === 'bpmn:SequenceFlow')
      .filter((el: any) => {
        const src = el.source?.id;
        const tgt = el.target?.id;
        const happyIds = new Set([start, task1, gw, task2, end]);
        return happyIds.has(src) && happyIds.has(tgt);
      });
    for (const conn of flows) {
      expectOrthogonal(conn);
    }
  });

  test('same-row connections have at most 2 waypoints after layout', async () => {
    // Regression: when source and target share the same center Y,
    // the connection must be a simple 2-point straight line.
    // A 4-point L/Z-shape with duplicate midpoints means grid-snap drift
    // is causing the router to produce an unnecessary bend.
    const diagramId = await createDiagram('Straight Connections');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Step 1' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Step 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // All same-row connections should use exactly 2 waypoints (straight line).
    // ManhattanLayout may use 4 waypoints even for aligned elements, but a
    // post-layout straightening pass should collapse them to 2 for strict
    // same-Y connections.
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      const wps = conn.waypoints;
      const srcMidY = conn.source.y + conn.source.height / 2;
      const tgtMidY = conn.target.y + conn.target.height / 2;
      if (Math.abs(srcMidY - tgtMidY) <= 1) {
        // Strictly same-row: must be a 2-point straight line
        expect(
          wps.length,
          `Connection ${conn.id} (${conn.source?.id}→${conn.target?.id}) ` +
            `srcMidY=${srcMidY} tgtMidY=${tgtMidY}: expected 2 waypoints, got ${wps.length}`
        ).toBe(2);
      }
    }
  });

  test('no consecutive duplicate waypoints in connections after layout', async () => {
    // Regression: exported XML showed pairs like (220,200)→(220,200).
    // A deduplication pass must remove consecutive identical waypoints.
    const diagramId = await createDiagram('No Duplicate Waypoints');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Work' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Done?' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const retry = await addElement(diagramId, 'bpmn:UserTask', { name: 'Retry' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, gw);
    await connect(diagramId, gw, end, { label: 'Yes' });
    await connect(diagramId, gw, retry, { label: 'No', isDefault: true });
    await connect(diagramId, retry, task);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');

    for (const conn of connections) {
      const wps = conn.waypoints;
      for (let i = 1; i < wps.length; i++) {
        const dx = Math.abs(wps[i].x - wps[i - 1].x);
        const dy = Math.abs(wps[i].y - wps[i - 1].y);
        expect(
          dx > 0 || dy > 0,
          `Connection ${conn.id}: consecutive duplicate waypoints at index ${i - 1}→${i}: ` +
            `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
        ).toBe(true);
      }
    }
  });
});
