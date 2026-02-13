import { describe, test, expect, beforeEach } from 'vitest';
import { handleAdjustLabels } from '../../src/handlers/layout/labels/adjust-labels-handler';

import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../helpers';

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
    expect(res).toHaveProperty('flowLabelsMoved');
    expect(res).toHaveProperty('totalMoved');
    expect(typeof res.elementLabelsMoved).toBe('number');
    expect(typeof res.flowLabelsMoved).toBe('number');
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
});
