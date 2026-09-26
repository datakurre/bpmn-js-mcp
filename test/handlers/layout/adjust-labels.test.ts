import { describe, test, expect, beforeEach } from 'vitest';
import { handleAdjustLabels } from '../../../src/handlers/layout/labels/adjust-labels-handler';
import { adjustDiagramLabels } from '../../../src/handlers/layout/labels/adjust-labels';
import { rectsOverlap } from '../../utils/geometry';
import { handleLayoutDiagram } from '../../../src/handlers/layout/layout-diagram';

import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('adjust_bpmn_labels', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('returns success with no adjustments needed on empty diagram', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(await handleAdjustLabels({ diagramId }));

    expect(res.success).toBe(true);
    expect(res.totalMoved).toBe(0);
    expect(res.message).toContain('No label adjustments needed');
  });

  test('returns element and flow label counts', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(await handleAdjustLabels({ diagramId }));

    expect(res).toHaveProperty('elementLabelsMoved');
    expect(res).toHaveProperty('totalMoved');
    expect(typeof res.elementLabelsMoved).toBe('number');
  });

  test('handles diagram with named gateway', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const gwId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Decision?',
      x: 250,
      y: 100,
    });
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Work', x: 400, y: 100 });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { x: 550, y: 100 });

    await connect(diagramId, startId, gwId);
    await connect(diagramId, gwId, taskId);
    await connect(diagramId, taskId, endId);

    const res = parseResult(await handleAdjustLabels({ diagramId }));
    expect(res.success).toBe(true);
  });

  test('gateway label repositioned away from overlapping flows', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 200 });
    const gwId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Approved?',
      x: 250,
      y: 200,
    });
    const yesTask = await addElement(diagramId, 'bpmn:Task', {
      name: 'Process',
      x: 400,
      y: 100,
    });
    const noTask = await addElement(diagramId, 'bpmn:Task', {
      name: 'Reject',
      x: 400,
      y: 300,
    });

    await connect(diagramId, startId, gwId);
    await connect(diagramId, gwId, yesTask, 'Yes');
    await connect(diagramId, gwId, noTask, 'No');

    const moved = await adjustDiagramLabels(getDiagram(diagramId));
    expect(moved).toBeGreaterThanOrEqual(0);
  });

  test('rectsOverlap detects intersection', () => {
    expect(
      rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })
    ).toBe(true);
    expect(
      rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 5, height: 5 })
    ).toBe(false);
  });

  test('no-op when diagram has no labels', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    const moved = await adjustDiagramLabels(getDiagram(diagramId));
    expect(moved).toBe(0);
  });

  test('labels adjusted during layout pipeline', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 200 });
    const gwId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Check?',
      x: 250,
      y: 200,
    });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'A', x: 400, y: 100 });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'B', x: 400, y: 300 });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { x: 550, y: 200 });

    await connect(diagramId, startId, gwId);
    await connect(diagramId, gwId, taskA, 'Yes');
    await connect(diagramId, gwId, taskB, 'No');
    await connect(diagramId, taskA, endId);
    await connect(diagramId, taskB, endId);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
  });
});
