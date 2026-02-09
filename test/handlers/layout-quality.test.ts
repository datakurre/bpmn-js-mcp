/**
 * Layout quality regression tests.
 *
 * These tests build known BPMN patterns and assert specific layout
 * properties after ELK layout:
 * - All flows are strictly orthogonal (no diagonals)
 * - Same-row elements share Y within ±1 px
 * - Flow waypoints have minimal bend count
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleConnect } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

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

  it('sequential flow: all connections orthogonal, elements on same Y', async () => {
    const diagramId = await createDiagram('Sequential Quality');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 2' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 3' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: t1 });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: t2 });
    await handleConnect({ diagramId, sourceElementId: t2, targetElementId: t3 });
    await handleConnect({ diagramId, sourceElementId: t3, targetElementId: end });

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

  it('exclusive branch with merge: orthogonal flows, branch elements on distinct rows', async () => {
    const diagramId = await createDiagram('Exclusive Merge Quality');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decision' });
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
      isDefault: true,
    });
    await handleConnect({ diagramId, sourceElementId: taskYes, targetElementId: merge });
    await handleConnect({ diagramId, sourceElementId: taskNo, targetElementId: merge });
    await handleConnect({ diagramId, sourceElementId: merge, targetElementId: end });

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

  it('parallel branch with merge: orthogonal flows', async () => {
    const diagramId = await createDiagram('Parallel Merge Quality');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 2' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 3' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: split });
    await handleConnect({ diagramId, sourceElementId: split, targetElementId: t1 });
    await handleConnect({ diagramId, sourceElementId: split, targetElementId: t2 });
    await handleConnect({ diagramId, sourceElementId: split, targetElementId: t3 });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: t2, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: t3, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: join, targetElementId: end });

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

  it('exclusive branch without merge gateway: flows to shared end event are orthogonal', async () => {
    // Reproduces the example.bpmn pattern where two branches merge at an EndEvent
    const diagramId = await createDiagram('Shared EndEvent Quality');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: gw });
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: taskA,
      label: 'A',
    });
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: taskB,
      label: 'B',
      isDefault: true,
    });
    await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: end });
    await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: end });

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

  it('same-layer elements are vertically aligned after snap', async () => {
    // Build: Start → Task → Gateway → [Yes→End1, No→End2]
    // Gateway and the two end events should be in different layers,
    // but Start and Task should be on the same Y row
    const diagramId = await createDiagram('Vertical Snap Quality');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Work' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });

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

  it('left-to-right ordering preserved in complex patterns', async () => {
    const diagramId = await createDiagram('L2R Complex');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'First' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'GW' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Branch A' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });
    const join = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Join' });
    const t4 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Final' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: t1 });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: gw });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: t2 });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: t3, isDefault: true });
    await handleConnect({ diagramId, sourceElementId: t2, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: t3, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: join, targetElementId: t4 });
    await handleConnect({ diagramId, sourceElementId: t4, targetElementId: end });

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
});
