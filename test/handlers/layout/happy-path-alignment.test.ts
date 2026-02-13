/**
 * Tests for the happy-path vertical alignment pass (AI-3).
 *
 * After ELK layout + gridSnap, the happy-path alignment pass should
 * snap all happy-path elements to a common Y-centre, eliminating
 * the 5–15 px wobble from ELK's gateway port placement offsets.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

describe('Happy-path vertical alignment', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sequential flow: all elements share the same Y-centre within 1px', async () => {
    const diagramId = await createDiagram('HP Align Sequential');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const elements = [start, t1, t2, end].map((id) => reg.get(id));
    const refY = centreY(elements[0]);

    for (const el of elements) {
      expect(
        Math.abs(centreY(el) - refY),
        `${el.id} Y-centre should match reference`
      ).toBeLessThanOrEqual(1);
    }
  });

  test('exclusive gateway: main-chain elements aligned, branches on distinct rows', async () => {
    const diagramId = await createDiagram('HP Align Gateway');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decide' });
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

    // The main-chain elements (Start, GW, Merge, End) that are NOT branch
    // targets should share the same Y-centre.  Branch targets (Yes/No)
    // are intentionally placed symmetrically by gridSnapPass.
    const mainChain = [start, gw, merge, end].map((id) => reg.get(id));
    const refY = centreY(mainChain[0]);

    for (const el of mainChain) {
      expect(
        Math.abs(centreY(el) - refY),
        `${el.id} should be on the main row`
      ).toBeLessThanOrEqual(1);
    }

    // Both branches should be on different rows from each other
    const yesEl = reg.get(taskYes);
    const noEl = reg.get(taskNo);
    expect(Math.abs(centreY(yesEl) - centreY(noEl))).toBeGreaterThan(10);
  });

  test('parallel gateway: happy-path branch aligned, other branches on distinct rows', async () => {
    const diagramId = await createDiagram('HP Align Parallel');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 2' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, split);
    await connect(diagramId, split, t1);
    await connect(diagramId, split, t2);
    await connect(diagramId, t1, join);
    await connect(diagramId, t2, join);
    await connect(diagramId, join, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Happy path follows first outgoing: Start → Split → t1 → Join → End
    const happyElements = [start, split, join, end].map((id) => reg.get(id));
    const refY = centreY(happyElements[0]);

    // Start, Split, Join, End should share the same Y (within 1px)
    for (const el of happyElements) {
      expect(
        Math.abs(centreY(el) - refY),
        `${el.id} should be on the happy-path row`
      ).toBeLessThanOrEqual(1);
    }

    // Branch 2 should be on a different row from the happy path
    const t2El = reg.get(t2);
    expect(Math.abs(centreY(t2El) - refY)).toBeGreaterThan(10);
  });
});
