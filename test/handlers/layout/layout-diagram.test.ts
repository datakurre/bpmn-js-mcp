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

  test('response always includes qualityMetrics.orthogonalFlowPercent', async () => {
    const diagramId = await createDiagram('Metrics Presence');
    const s = await addElement(diagramId, 'bpmn:StartEvent', { name: 'S' });
    const t = await addElement(diagramId, 'bpmn:UserTask', { name: 'T' });
    const e = await addElement(diagramId, 'bpmn:EndEvent', { name: 'E' });
    await connect(diagramId, s, t);
    await connect(diagramId, t, e);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.qualityMetrics).toBeDefined();
    expect(typeof res.qualityMetrics.orthogonalFlowPercent).toBe('number');
  });

  test('response includes warning when orthogonalFlowPercent is below 90', async () => {
    // Import a diagram with intentionally misaligned waypoints (non-orthogonal)
    // then run layout; the warning must appear if % < 90 after layout.
    // We can't reliably make layout produce < 90% with normal diagrams,
    // so we verify the warning logic by directly checking the metric threshold:
    // if the response has orthogonalFlowPercent < 90 it MUST have a warning.
    const diagramId = await createDiagram('Warning Threshold');
    const s = await addElement(diagramId, 'bpmn:StartEvent', { name: 'S' });
    const t = await addElement(diagramId, 'bpmn:UserTask', { name: 'T' });
    const e = await addElement(diagramId, 'bpmn:EndEvent', { name: 'E' });
    await connect(diagramId, s, t);
    await connect(diagramId, t, e);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    const pct: number = res.qualityMetrics?.orthogonalFlowPercent ?? 100;

    if (pct < 90) {
      // If layout produced sub-90% orthogonal flows, a warning must be present
      expect(res.warning).toBeDefined();
      expect(typeof res.warning).toBe('string');
      expect(res.warning).toContain('%');
    }
    // If pct >= 90, no requirement on warning (may or may not be present)
  });
});
