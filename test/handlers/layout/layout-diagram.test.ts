import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';

describe('layout_bpmn_diagram', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('runs layout on a diagram', async () => {
    const diagramId = await createDiagram('Composite Layout Test');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 100,
      y: 100,
    });
    await connect(diagramId, startId, endId);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.elementCount).toBeGreaterThanOrEqual(2);
  });
});
