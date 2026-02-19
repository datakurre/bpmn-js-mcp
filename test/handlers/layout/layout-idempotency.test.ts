/**
 * Tests for layout idempotency (I4 / C5).
 *
 * Verifies that running `layout_bpmn_diagram` twice on the same diagram
 * produces nearly identical element positions.  Non-idempotent layout
 * indicates non-determinism in ELK or post-processing steps.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

/** Capture x/y positions of all shapes in the element registry. */
function capturePositions(
  elementRegistry: ReturnType<ReturnType<typeof getDiagram>['modeler']['get']>
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const all: Array<{ id: string; x?: number; y?: number; width?: number }> =
    elementRegistry.getAll();
  for (const el of all) {
    if (el.x !== undefined && el.width !== undefined) {
      positions[el.id] = { x: el.x, y: el.y ?? 0 };
    }
  }
  return positions;
}

/** Max tolerated drift (px) between two layout runs on the same diagram. */
const IDEMPOTENCY_TOLERANCE = 3;

describe('layout idempotency', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('linear flow positions are stable across two layout runs', async () => {
    const diagramId = await createDiagram('Idempotency — Linear');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    await handleLayoutDiagram({ diagramId });
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const pos1 = capturePositions(reg);

    await handleLayoutDiagram({ diagramId });
    const pos2 = capturePositions(reg);

    for (const id of Object.keys(pos1)) {
      expect(
        Math.abs(pos1[id].x - pos2[id].x),
        `Element ${id} x drifted by ${Math.abs(pos1[id].x - pos2[id].x)}px`
      ).toBeLessThanOrEqual(IDEMPOTENCY_TOLERANCE);
      expect(
        Math.abs(pos1[id].y - pos2[id].y),
        `Element ${id} y drifted by ${Math.abs(pos1[id].y - pos2[id].y)}px`
      ).toBeLessThanOrEqual(IDEMPOTENCY_TOLERANCE);
    }
  });

  test('parallel gateway positions are stable across two layout runs', async () => {
    const diagramId = await createDiagram('Idempotency — Parallel');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, split);
    await connect(diagramId, split, taskA);
    await connect(diagramId, split, taskB);
    await connect(diagramId, taskA, join);
    await connect(diagramId, taskB, join);
    await connect(diagramId, join, end);

    await handleLayoutDiagram({ diagramId });
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const pos1 = capturePositions(reg);

    await handleLayoutDiagram({ diagramId });
    const pos2 = capturePositions(reg);

    for (const id of Object.keys(pos1)) {
      expect(
        Math.abs(pos1[id].x - pos2[id].x),
        `Element ${id} x drifted by ${Math.abs(pos1[id].x - pos2[id].x)}px`
      ).toBeLessThanOrEqual(IDEMPOTENCY_TOLERANCE);
      expect(
        Math.abs(pos1[id].y - pos2[id].y),
        `Element ${id} y drifted by ${Math.abs(pos1[id].y - pos2[id].y)}px`
      ).toBeLessThanOrEqual(IDEMPOTENCY_TOLERANCE);
    }
  });

  test('exclusive gateway (happy-path) positions are stable across two runs', async () => {
    const diagramId = await createDiagram('Idempotency — Exclusive');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'OK?' });
    const happy = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
    const reject = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Reject' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, happy, { label: 'Yes' });
    await connect(diagramId, gw, reject, { label: 'No' });
    await connect(diagramId, happy, end);

    await handleLayoutDiagram({ diagramId });
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const pos1 = capturePositions(reg);

    await handleLayoutDiagram({ diagramId });
    const pos2 = capturePositions(reg);

    for (const id of Object.keys(pos1)) {
      expect(
        Math.abs(pos1[id].x - pos2[id].x),
        `Element ${id} x drifted by ${Math.abs(pos1[id].x - pos2[id].x)}px`
      ).toBeLessThanOrEqual(IDEMPOTENCY_TOLERANCE);
      expect(
        Math.abs(pos1[id].y - pos2[id].y),
        `Element ${id} y drifted by ${Math.abs(pos1[id].y - pos2[id].y)}px`
      ).toBeLessThanOrEqual(IDEMPOTENCY_TOLERANCE);
    }
  });

  test('three consecutive layout runs produce consistent positions', async () => {
    const diagramId = await createDiagram('Idempotency — Triple Run');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Validate' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const errEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Error' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, gw);
    await connect(diagramId, gw, t2, { label: 'valid' });
    await connect(diagramId, gw, errEnd, { label: 'invalid' });
    await connect(diagramId, t2, end);

    await handleLayoutDiagram({ diagramId });
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const pos1 = capturePositions(reg);

    await handleLayoutDiagram({ diagramId });
    const pos2 = capturePositions(reg);

    await handleLayoutDiagram({ diagramId });
    const pos3 = capturePositions(reg);

    for (const id of Object.keys(pos1)) {
      // Run 1 → 2
      expect(
        Math.abs(pos1[id].x - pos2[id].x),
        `Run1→Run2: Element ${id} x drifted`
      ).toBeLessThanOrEqual(IDEMPOTENCY_TOLERANCE);
      // Run 2 → 3
      expect(
        Math.abs(pos2[id].x - pos3[id].x),
        `Run2→Run3: Element ${id} x drifted`
      ).toBeLessThanOrEqual(IDEMPOTENCY_TOLERANCE);
    }
  });
});
