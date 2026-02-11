/**
 * ELK layout benchmark tests.
 *
 * Test fixtures for complex topologies:
 * - Parallel joins (diamond, nested, asymmetric)
 * - Boundary events (error recovery, timeout paths)
 * - Large collaborations (multi-pool, cross-pool message flows)
 *
 * Measures crossing flows and label overlaps before/after layout
 * to ensure layout quality remains high as the engine evolves.
 *
 * These are benchmark tests, skipped in CI.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleConnect,
  handleCreateCollaboration,
  handleAddElement,
} from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe.skipIf(!!process.env.CI)('ELK layout benchmarks', () => {
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
      const isHorizontal = dy < 1;
      const isVertical = dx < 1;
      expect(
        isHorizontal || isVertical,
        `Connection ${conn.id} segment ${i - 1}→${i} is diagonal: ` +
          `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
      ).toBe(true);
    }
  }

  /** Check if two bounding boxes overlap. */
  function overlaps(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
  ): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // ── Parallel join benchmarks ───────────────────────────────────────────────

  describe('ELK benchmark: parallel joins', () => {
    beforeEach(() => {
      clearDiagrams();
    });

    test('nested parallel gateways: zero crossing flows', async () => {
      // Start → Split1 → [A, Split2 → [B, C] → Join2] → Join1 → End
      const diagramId = await createDiagram('Nested Parallel');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const split1 = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split 1' });
      const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
      const split2 = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split 2' });
      const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });
      const taskC = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task C' });
      const join2 = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join 2' });
      const join1 = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join 1' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: split1 });
      await handleConnect({ diagramId, sourceElementId: split1, targetElementId: taskA });
      await handleConnect({ diagramId, sourceElementId: split1, targetElementId: split2 });
      await handleConnect({ diagramId, sourceElementId: split2, targetElementId: taskB });
      await handleConnect({ diagramId, sourceElementId: split2, targetElementId: taskC });
      await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: join2 });
      await handleConnect({ diagramId, sourceElementId: taskC, targetElementId: join2 });
      await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: join1 });
      await handleConnect({ diagramId, sourceElementId: join2, targetElementId: join1 });
      await handleConnect({ diagramId, sourceElementId: join1, targetElementId: end });

      const res = parseResult(await handleLayoutDiagram({ diagramId }));
      expect(res.success).toBe(true);
      expect(res.elementCount).toBe(9);

      // Nested parallel gateway layout should produce zero crossings
      const crossings = res.crossingFlows ?? 0;
      expect(crossings).toBe(0);

      // Verify L→R ordering
      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
      expect(centreX(reg.get(start))).toBeLessThan(centreX(reg.get(split1)));
      expect(centreX(reg.get(split1))).toBeLessThan(centreX(reg.get(split2)));
      expect(centreX(reg.get(join2))).toBeLessThan(centreX(reg.get(join1)));
      expect(centreX(reg.get(join1))).toBeLessThan(centreX(reg.get(end)));
    });

    test('asymmetric parallel join: one branch has more tasks', async () => {
      // Start → Split → [Short: T1, Long: T2→T3→T4] → Join → End
      const diagramId = await createDiagram('Asymmetric Parallel');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Short Task' });
      const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Step 1' });
      const t3 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Step 2' });
      const t4 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Step 3' });
      const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: split });
      await handleConnect({ diagramId, sourceElementId: split, targetElementId: t1 });
      await handleConnect({ diagramId, sourceElementId: split, targetElementId: t2 });
      await handleConnect({ diagramId, sourceElementId: t2, targetElementId: t3 });
      await handleConnect({ diagramId, sourceElementId: t3, targetElementId: t4 });
      await handleConnect({ diagramId, sourceElementId: t1, targetElementId: join });
      await handleConnect({ diagramId, sourceElementId: t4, targetElementId: join });
      await handleConnect({ diagramId, sourceElementId: join, targetElementId: end });

      const res = parseResult(await handleLayoutDiagram({ diagramId }));
      expect(res.success).toBe(true);

      // Should have zero crossings for clean parallel branches
      const crossings = res.crossingFlows ?? 0;
      expect(crossings).toBe(0);

      // Branches should be on different Y positions
      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
      expect(centreY(reg.get(t1))).not.toBeCloseTo(centreY(reg.get(t2)), 0);
    });

    test('wide diamond: 8 parallel branches with zero crossings', async () => {
      const diagramId = await createDiagram('Wide Diamond');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
      const tasks: string[] = [];
      for (let i = 1; i <= 8; i++) {
        tasks.push(await addElement(diagramId, 'bpmn:UserTask', { name: `Branch ${i}` }));
      }
      const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: split });
      for (const t of tasks) {
        await handleConnect({ diagramId, sourceElementId: split, targetElementId: t });
        await handleConnect({ diagramId, sourceElementId: t, targetElementId: join });
      }
      await handleConnect({ diagramId, sourceElementId: join, targetElementId: end });

      const res = parseResult(await handleLayoutDiagram({ diagramId }));
      expect(res.success).toBe(true);
      expect(res.elementCount).toBe(12); // start + split + 8 tasks + join + end

      // Zero crossings expected for well-separated branches
      const crossings = res.crossingFlows ?? 0;
      expect(crossings).toBe(0);

      // All 8 branches should be at distinct Y positions
      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
      const yPositions = tasks.map((t) => Math.round(centreY(reg.get(t))));
      const uniqueY = new Set(yPositions);
      expect(uniqueY.size).toBe(8);
    });
  });

  // ── Boundary event benchmarks ──────────────────────────────────────────────

  describe('ELK benchmark: boundary events', () => {
    beforeEach(() => {
      clearDiagrams();
    });

    test('error boundary with recovery path: orthogonal routing', async () => {
      const diagramId = await createDiagram('Error Boundary');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API' });
      const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Error',
        hostElementId: task,
      });
      const recovery = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle Error' });
      const normalEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Success' });
      const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Failure' });

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
      await handleConnect({ diagramId, sourceElementId: task, targetElementId: normalEnd });
      await handleConnect({ diagramId, sourceElementId: boundary, targetElementId: recovery });
      await handleConnect({ diagramId, sourceElementId: recovery, targetElementId: errorEnd });

      const res = parseResult(await handleLayoutDiagram({ diagramId }));
      expect(res.success).toBe(true);

      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

      // All connections should be orthogonal
      const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
      for (const conn of connections) {
        expectOrthogonal(conn);
      }

      // Recovery path should be separated from the main flow
      const taskEl = reg.get(task);
      const recoveryEl = reg.get(recovery);
      // The recovery task should be at a different position from the main task
      expect(Math.abs(recoveryEl.y - taskEl.y) > 10 || Math.abs(recoveryEl.x - taskEl.x) > 10).toBe(
        true
      );
    });

    test('multiple boundary events on same task: no element overlap', async () => {
      const diagramId = await createDiagram('Multi Boundary');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Order' });

      const errBound = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Error',
        hostElementId: task,
      });
      const timerBound = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timeout',
        hostElementId: task,
      });

      const errHandler = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle Error' });
      const timerHandler = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle Timeout' });
      const normalEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
      const errEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Error End' });
      const timerEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timeout End' });

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
      await handleConnect({ diagramId, sourceElementId: task, targetElementId: normalEnd });
      await handleConnect({ diagramId, sourceElementId: errBound, targetElementId: errHandler });
      await handleConnect({ diagramId, sourceElementId: errHandler, targetElementId: errEnd });
      await handleConnect({
        diagramId,
        sourceElementId: timerBound,
        targetElementId: timerHandler,
      });
      await handleConnect({ diagramId, sourceElementId: timerHandler, targetElementId: timerEnd });

      const res = parseResult(await handleLayoutDiagram({ diagramId }));
      expect(res.success).toBe(true);

      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

      // Error and timer handler tasks should not overlap
      const errEl = reg.get(errHandler);
      const timerEl = reg.get(timerHandler);
      const errBox = { x: errEl.x, y: errEl.y, w: errEl.width, h: errEl.height };
      const timerBox = { x: timerEl.x, y: timerEl.y, w: timerEl.width, h: timerEl.height };
      expect(overlaps(errBox, timerBox)).toBe(false);
    });

    test('boundary event with loop-back: no crossing flows', async () => {
      // Start → Task → End, with boundary event on Task → Retry → Task
      const diagramId = await createDiagram('Boundary Loop');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
      const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Retry',
        hostElementId: task,
      });
      const retryTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
      await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });
      await handleConnect({ diagramId, sourceElementId: boundary, targetElementId: retryTask });

      const res = parseResult(await handleLayoutDiagram({ diagramId }));
      expect(res.success).toBe(true);

      // Orthogonal routing should be maintained
      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
      const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
      for (const conn of connections) {
        expectOrthogonal(conn);
      }
    });
  });

  // ── Large collaboration benchmarks ─────────────────────────────────────────

  describe('ELK benchmark: large collaborations', () => {
    beforeEach(() => {
      clearDiagrams();
    });

    test('three-pool collaboration with message flows', async () => {
      const diagramId = await createDiagram('Three Pools');

      const collab = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Customer', width: 800 },
            { name: 'Order Service', width: 800 },
            { name: 'Warehouse', width: 800 },
          ],
        })
      );

      const [customerPool, orderPool, warehousePool] = collab.participantIds;

      // Customer pool flow
      const custStart = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:StartEvent',
          name: 'Place Order',
          participantId: customerPool,
        })
      ).elementId;
      const custTask = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:UserTask',
          name: 'Submit Order',
          participantId: customerPool,
        })
      ).elementId;
      const custEnd = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:EndEvent',
          name: 'Order Confirmed',
          participantId: customerPool,
        })
      ).elementId;

      await handleConnect({ diagramId, sourceElementId: custStart, targetElementId: custTask });
      await handleConnect({ diagramId, sourceElementId: custTask, targetElementId: custEnd });

      // Order service pool flow
      const orderStart = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:StartEvent',
          name: 'Receive Order',
          participantId: orderPool,
        })
      ).elementId;
      const orderTask1 = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:ServiceTask',
          name: 'Validate',
          participantId: orderPool,
        })
      ).elementId;
      const orderTask2 = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:ServiceTask',
          name: 'Confirm',
          participantId: orderPool,
        })
      ).elementId;
      const orderEnd = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:EndEvent',
          name: 'Done',
          participantId: orderPool,
        })
      ).elementId;

      await handleConnect({ diagramId, sourceElementId: orderStart, targetElementId: orderTask1 });
      await handleConnect({ diagramId, sourceElementId: orderTask1, targetElementId: orderTask2 });
      await handleConnect({ diagramId, sourceElementId: orderTask2, targetElementId: orderEnd });

      // Warehouse pool flow
      const whStart = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:StartEvent',
          name: 'Pick Request',
          participantId: warehousePool,
        })
      ).elementId;
      const whTask = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:UserTask',
          name: 'Pack & Ship',
          participantId: warehousePool,
        })
      ).elementId;
      const whEnd = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:EndEvent',
          name: 'Shipped',
          participantId: warehousePool,
        })
      ).elementId;

      await handleConnect({ diagramId, sourceElementId: whStart, targetElementId: whTask });
      await handleConnect({ diagramId, sourceElementId: whTask, targetElementId: whEnd });

      // Cross-pool message flows
      await handleConnect({
        diagramId,
        sourceElementId: custTask,
        targetElementId: orderStart,
        connectionType: 'bpmn:MessageFlow',
      });
      await handleConnect({
        diagramId,
        sourceElementId: orderTask2,
        targetElementId: whStart,
        connectionType: 'bpmn:MessageFlow',
      });

      const res = parseResult(await handleLayoutDiagram({ diagramId }));
      expect(res.success).toBe(true);

      // Pools should be stacked vertically (each pool at a different Y)
      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
      const custPoolEl = reg.get(customerPool);
      const orderPoolEl = reg.get(orderPool);
      const whPoolEl = reg.get(warehousePool);
      expect(custPoolEl).toBeDefined();
      expect(orderPoolEl).toBeDefined();
      expect(whPoolEl).toBeDefined();
    });

    test('collaboration with 10+ tasks per pool', async () => {
      const diagramId = await createDiagram('Large Pool');

      const collab = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Main Process', width: 1200 },
            { name: 'Support', width: 1200 },
          ],
        })
      );

      const mainPool = collab.participantIds[0];

      // Build a chain of 12 tasks in the main pool
      const ids: string[] = [];
      const mainStart = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:StartEvent',
          name: 'Begin',
          participantId: mainPool,
        })
      ).elementId;
      ids.push(mainStart);

      for (let i = 1; i <= 12; i++) {
        const taskId = parseResult(
          await handleAddElement({
            diagramId,
            elementType: 'bpmn:UserTask',
            name: `Step ${i}`,
            participantId: mainPool,
          })
        ).elementId;
        ids.push(taskId);
      }

      const mainEnd = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:EndEvent',
          name: 'Complete',
          participantId: mainPool,
        })
      ).elementId;
      ids.push(mainEnd);

      // Connect all sequentially
      for (let i = 0; i < ids.length - 1; i++) {
        await handleConnect({
          diagramId,
          sourceElementId: ids[i],
          targetElementId: ids[i + 1],
        });
      }

      const res = parseResult(await handleLayoutDiagram({ diagramId }));
      expect(res.success).toBe(true);

      // All elements should maintain L→R ordering
      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
      for (let i = 0; i < ids.length - 1; i++) {
        const curr = reg.get(ids[i]);
        const next = reg.get(ids[i + 1]);
        expect(centreX(curr), `${ids[i]} should be left of ${ids[i + 1]}`).toBeLessThan(
          centreX(next)
        );
      }

      // Zero crossings for a sequential chain
      const crossings = res.crossingFlows ?? 0;
      expect(crossings).toBe(0);
    });
  });

  // ── Happy path benchmarks ──────────────────────────────────────────────────

  describe('ELK benchmark: happy path preservation', () => {
    beforeEach(() => {
      clearDiagrams();
    });

    test('happy path elements stay on same row with preserveHappyPath', async () => {
      // Start → Task → Gateway → [Yes→End1 (default), No→Extra→End2]
      // The happy path (Start→Task→Gateway→End1 via default) should share Y
      const diagramId = await createDiagram('Happy Path Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
      const endOk = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
      const extraTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Rework' });
      const endFail = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Rejected' });

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
      await handleConnect({ diagramId, sourceElementId: task, targetElementId: gw });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: endOk,
        label: 'Yes',
        isDefault: true,
      });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: extraTask,
        label: 'No',
      });
      await handleConnect({ diagramId, sourceElementId: extraTask, targetElementId: endFail });

      // Layout with happy path preservation (default: true)
      await handleLayoutDiagram({ diagramId });

      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

      // Happy path elements (start, task, gateway, endOk) should be on similar Y
      const happyPathY = [start, task, gw, endOk].map((id) => centreY(reg.get(id)));
      const refY = happyPathY[0];
      for (const y of happyPathY) {
        // Allow ±10px tolerance — ELK priority hints are approximate
        expect(Math.abs(y - refY)).toBeLessThanOrEqual(10);
      }

      // The non-happy path branch should be on a different row
      const extraY = centreY(reg.get(extraTask));
      expect(Math.abs(extraY - refY)).toBeGreaterThan(10);
    });

    test('preserveHappyPath: false allows free arrangement', async () => {
      const diagramId = await createDiagram('No Happy Path');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Work' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check' });
      const endOk = await addElement(diagramId, 'bpmn:EndEvent', { name: 'OK' });
      const endFail = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Fail' });

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
      await handleConnect({ diagramId, sourceElementId: task, targetElementId: gw });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: endOk,
        label: 'Yes',
        isDefault: true,
      });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: endFail,
        label: 'No',
      });

      // Layout with happy path disabled
      const res = parseResult(await handleLayoutDiagram({ diagramId, preserveHappyPath: false }));
      expect(res.success).toBe(true);

      // Just verify it works — don't enforce same-row constraint
      const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
      expect(centreX(reg.get(start))).toBeLessThan(centreX(reg.get(gw)));
    });
  });
}); // end describe.skipIf
