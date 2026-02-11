import { describe, test, expect, beforeEach } from 'vitest';
import { handleAdjustLabels } from '../../src/handlers/adjust-labels-handler';
import { handleConnect } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('handleAdjustLabels', () => {
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

    await handleConnect({ diagramId, sourceElementId: startId, targetElementId: gwId });
    await handleConnect({ diagramId, sourceElementId: gwId, targetElementId: taskId });
    await handleConnect({ diagramId, sourceElementId: taskId, targetElementId: endId });

    const res = parseResult(await handleAdjustLabels({ diagramId }));
    expect(res.success).toBe(true);
  });
});
