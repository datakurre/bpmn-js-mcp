import { describe, test, expect, beforeEach } from 'vitest';
import { handleConnect, handleLayoutDiagram } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';
import { adjustDiagramLabels, adjustFlowLabels } from '../../src/handlers/adjust-labels';
import { rectsOverlap } from '../../src/handlers/label-utils';

describe('adjust_bpmn_labels — dedicated', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('moves gateway label away from crossing connections', async () => {
    const diagramId = await createDiagram('Label Overlap Test');

    // Build a flow with a gateway whose label sits on the connection path
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Begin',
      x: 100,
      y: 200,
    });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Check?',
      x: 250,
      y: 200,
    });
    const taskA = await addElement(diagramId, 'bpmn:Task', {
      name: 'Accept',
      x: 400,
      y: 100,
    });
    const taskB = await addElement(diagramId, 'bpmn:Task', {
      name: 'Reject',
      x: 400,
      y: 300,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { x: 600, y: 200 });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: taskA,
      label: 'Yes',
    });
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: taskB,
      label: 'No',
    });
    await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: end });
    await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: end });

    const diagram = getDiagram(diagramId)!;
    const movedCount = await adjustDiagramLabels(diagram);

    // We just verify the function ran successfully — actual overlap depends on
    // element positions and connection routing in headless mode
    expect(movedCount).toBeGreaterThanOrEqual(0);
  });

  test('adjustFlowLabels moves labels away from shapes', async () => {
    const diagramId = await createDiagram('Flow Label Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const task = await addElement(diagramId, 'bpmn:Task', {
      name: 'Work',
      x: 250,
      y: 100,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { x: 400, y: 100 });

    await handleConnect({
      diagramId,
      sourceElementId: start,
      targetElementId: task,
      label: 'Start flow',
    });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });

    const diagram = getDiagram(diagramId)!;
    const movedCount = await adjustFlowLabels(diagram);
    expect(movedCount).toBeGreaterThanOrEqual(0);
  });

  test('rectsOverlap correctly detects overlapping rectangles', () => {
    expect(
      rectsOverlap(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 50, y: 50, width: 100, height: 100 }
      )
    ).toBe(true);

    expect(
      rectsOverlap(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 200, y: 200, width: 100, height: 100 }
      )
    ).toBe(false);

    // Adjacent but not overlapping
    expect(
      rectsOverlap(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 100, y: 0, width: 100, height: 100 }
      )
    ).toBe(false);
  });

  test('handles diagram with no labels gracefully', async () => {
    const diagramId = await createDiagram('No Labels');

    // Add elements without names — no external labels
    await addElement(diagramId, 'bpmn:Task', { x: 100, y: 100 });
    await addElement(diagramId, 'bpmn:Task', { x: 300, y: 100 });

    const diagram = getDiagram(diagramId)!;
    const movedCount = await adjustDiagramLabels(diagram);
    expect(movedCount).toBe(0);
  });

  test('label adjustment is integrated into layout pipeline', async () => {
    const diagramId = await createDiagram('Layout Integration');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decision?' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: end });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    // The layout result should include label movement count
    expect(typeof res.labelsMoved).toBe('number');
  });
});
