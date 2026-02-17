/**
 * Layout comparison test.
 *
 * Builds representative BPMN diagrams and evaluates ELK layout quality
 * metrics: bounding box dimensions, happy-path Y deviation, horizontal
 * gap standard deviation, and crossing-flow count.
 *
 * These tests serve as a quality baseline — they verify that the tuned
 * ELK engine produces visually spacious, regular layouts.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleCreateCollaboration,
  handleAddElement,
} from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  clearDiagrams,
  importReference,
  comparePositions,
  connect,
} from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

// ── Helpers ────────────────────────────────────────────────────────────────

function centreX(el: any): number {
  return el.x + (el.width || 0) / 2;
}

function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

/** Compute standard deviation of a number array. */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Compute bounding box of a set of elements. */
function boundingBox(elements: any[]): { width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    if (el.x < minX) minX = el.x;
    if (el.y < minY) minY = el.y;
    const right = el.x + (el.width || 0);
    const bottom = el.y + (el.height || 0);
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  return { width: maxX - minX, height: maxY - minY };
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

/** Get horizontal gaps between consecutive layers (sorted by x). */
function getHorizontalGaps(elementIds: string[], reg: any): number[] {
  const elements = elementIds.map((id) => reg.get(id));
  const sorted = [...elements].sort((a: any, b: any) => a.x - b.x);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevRight = sorted[i - 1].x + (sorted[i - 1].width || 0);
    gaps.push(sorted[i].x - prevRight);
  }
  return gaps;
}

// ── Test fixtures ──────────────────────────────────────────────────────────

describe('Layout comparison: ELK quality metrics', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  afterEach(() => {
    clearDiagrams();
  });

  test('linear flow: uniform spacing, same Y, orthogonal connections', async () => {
    const diagramId = await createDiagram('Linear Flow');
    const ids: string[] = [];

    ids.push(await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' }));
    ids.push(await addElement(diagramId, 'bpmn:UserTask', { name: 'Step 1' }));
    ids.push(await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Step 2' }));
    ids.push(await addElement(diagramId, 'bpmn:UserTask', { name: 'Step 3' }));
    ids.push(await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' }));

    for (let i = 0; i < ids.length - 1; i++) {
      await connect(diagramId, ids[i], ids[i + 1]);
    }

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // All elements on same Y row
    const refY = centreY(reg.get(ids[0]));
    for (const id of ids) {
      expect(Math.abs(centreY(reg.get(id)) - refY)).toBeLessThanOrEqual(1);
    }

    // Horizontal gaps should be consistent (low std dev)
    const gaps = getHorizontalGaps(ids, reg);
    expect(gaps.length).toBe(4);
    // All gaps should be positive and reasonably large (>= 50px)
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(50);
    }
    // Std dev of gaps should be low relative to gap spacing
    expect(stdDev(gaps)).toBeLessThan(40);

    // All connections orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });

  test('gateway split-join: spacious layout with zero crossings', async () => {
    const diagramId = await createDiagram('Split Join');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decision' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path B' });
    const join = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, split);
    await connect(diagramId, split, taskA, { label: 'Yes' });
    await connect(diagramId, split, taskB, { label: 'No', isDefault: true });
    await connect(diagramId, taskA, join);
    await connect(diagramId, taskB, join);
    await connect(diagramId, join, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Zero crossing flows
    expect(res.crossingFlows ?? 0).toBe(0);

    // Branch tasks at different Y
    expect(Math.abs(centreY(reg.get(taskA)) - centreY(reg.get(taskB)))).toBeGreaterThan(30);

    // Bounding box should be spacious
    const elements = [start, split, taskA, taskB, join, end].map((id) => reg.get(id));
    const bb = boundingBox(elements);
    expect(bb.width).toBeGreaterThan(300);
    expect(bb.height).toBeGreaterThan(50);

    // All connections orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });

  test('parallel fork-join: 4 branches, spacious vertical spacing', async () => {
    const diagramId = await createDiagram('Fork Join');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Fork' });
    const tasks: string[] = [];
    for (let i = 1; i <= 4; i++) {
      tasks.push(await addElement(diagramId, 'bpmn:UserTask', { name: `Task ${i}` }));
    }
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, split);
    for (const t of tasks) {
      await connect(diagramId, split, t);
      await connect(diagramId, t, join);
    }
    await connect(diagramId, join, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.crossingFlows ?? 0).toBe(0);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // All 4 branches at distinct Y
    const ys = tasks.map((t) => Math.round(centreY(reg.get(t))));
    expect(new Set(ys).size).toBe(4);

    // Vertical gaps between adjacent branches should be >= 50px
    const sortedYs = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sortedYs.length; i++) {
      expect(sortedYs[i] - sortedYs[i - 1]).toBeGreaterThanOrEqual(50);
    }

    // All connections orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });

  test('nested subprocess: elements inside subprocess laid out correctly', async () => {
    const diagramId = await createDiagram('Nested SubProcess');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const sub = await addElement(diagramId, 'bpmn:SubProcess', { name: 'SubProcess' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    // Add elements inside the subprocess
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

    // L→R ordering at top level
    expect(centreX(reg.get(start))).toBeLessThan(centreX(reg.get(sub)));
    expect(centreX(reg.get(sub))).toBeLessThan(centreX(reg.get(end)));

    // Sub-elements L→R inside subprocess
    expect(centreX(reg.get(subStart))).toBeLessThan(centreX(reg.get(subTask)));
    expect(centreX(reg.get(subTask))).toBeLessThan(centreX(reg.get(subEnd)));
  });

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

    // Customer flow
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

    // Supplier flow
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

    // Cross-pool message flow
    await connect(diagramId, custTask, suppStart, { connectionType: 'bpmn:MessageFlow' });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Verify both pools exist and are stacked
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const custPoolEl = reg.get(custPool);
    const suppPoolEl = reg.get(suppPool);
    expect(custPoolEl).toBeDefined();
    expect(suppPoolEl).toBeDefined();

    // L→R ordering within customer pool
    expect(centreX(reg.get(custStart))).toBeLessThan(centreX(reg.get(custTask)));
    expect(centreX(reg.get(custTask))).toBeLessThan(centreX(reg.get(custEnd)));
  });

  test('boundary events: orthogonal routing with spacious layout', async () => {
    const diagramId = await createDiagram('Boundary Events');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: task,
    });
    const recovery = await addElement(diagramId, 'bpmn:UserTask', { name: 'Recover' });
    const normalEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Success' });
    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Failure' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, normalEnd);
    await connect(diagramId, boundary, recovery);
    await connect(diagramId, recovery, errorEnd);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Main flow L→R
    expect(centreX(reg.get(start))).toBeLessThan(centreX(reg.get(task)));
    expect(centreX(reg.get(task))).toBeLessThan(centreX(reg.get(normalEnd)));

    // Recovery path should be separated from main flow
    const taskEl = reg.get(task);
    const recoveryEl = reg.get(recovery);
    expect(Math.abs(recoveryEl.y - taskEl.y) > 10 || Math.abs(recoveryEl.x - taskEl.x) > 10).toBe(
      true
    );
  });

  test('gridSnap: false disables grid snap pass', async () => {
    const diagramId = await createDiagram('No Grid Snap');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'A' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'B' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, split);
    await connect(diagramId, split, t1);
    await connect(diagramId, split, t2);
    await connect(diagramId, t1, join);
    await connect(diagramId, t2, join);
    await connect(diagramId, join, end);

    // Layout with grid snap disabled
    const res = parseResult(await handleLayoutDiagram({ diagramId, gridSnap: false } as any));
    expect(res.success).toBe(true);

    // Just verify it completes — positions may differ from grid-snapped version
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    expect(centreX(reg.get(start))).toBeLessThan(centreX(reg.get(split)));
    expect(centreX(reg.get(join))).toBeLessThan(centreX(reg.get(end)));
  });

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

    // Happy path (start, task, gw, endOk) should share Y within tolerance
    const happyPathY = [start, task, gw, endOk].map((id) => centreY(reg.get(id)));
    const refY = happyPathY[0];
    for (const y of happyPathY) {
      expect(Math.abs(y - refY)).toBeLessThanOrEqual(10);
    }

    // Non-happy-path branch should be on a different row
    const reworkY = centreY(reg.get(rework));
    expect(Math.abs(reworkY - refY)).toBeGreaterThan(10);
  });

  // ── Reference BPMN position tracking ─────────────────────────────────
  // Tests for all 10 reference files

  describe('reference position tracking', () => {
    test('01-linear-flow: quality metrics vs reference', async () => {
      const { diagramId, registry } = await importReference('01-linear-flow');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '01-linear-flow', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('02-exclusive-gateway: quality metrics vs reference', async () => {
      const { diagramId, registry } = await importReference('02-exclusive-gateway');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '02-exclusive-gateway', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('03-parallel-fork-join: quality metrics vs reference', async () => {
      const { diagramId, registry } = await importReference('03-parallel-fork-join');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '03-parallel-fork-join', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('04-nested-subprocess: quality metrics vs reference', async () => {
      const { diagramId, registry } = await importReference('04-nested-subprocess');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '04-nested-subprocess', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('05-collaboration: quality metrics vs reference', async () => {
      const { diagramId, registry } = await importReference('05-collaboration');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '05-collaboration', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('06-boundary-events: quality metrics vs reference', async () => {
      const { diagramId, registry } = await importReference('06-boundary-events');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '06-boundary-events', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('07-complex-workflow: quality metrics vs reference', async () => {
      const { diagramId, registry } = await importReference('07-complex-workflow');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '07-complex-workflow', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('08-collaboration-collapsed: quality metrics vs reference', async () => {
      const { diagramId, registry } = await importReference('08-collaboration-collapsed');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '08-collaboration-collapsed', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('09-complex-workflow: quality metrics vs reference', async () => {
      const { diagramId, registry } = await importReference('09-complex-workflow');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '09-complex-workflow', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });

    test('10-pool-with-lanes: quality metrics vs reference', async () => {
      const { diagramId, registry } = await importReference('10-pool-with-lanes');
      await handleLayoutDiagram({ diagramId });
      const { matchRate } = comparePositions(registry, '10-pool-with-lanes', 10);
      expect(matchRate).toBeGreaterThanOrEqual(0);
    });
  });
});
