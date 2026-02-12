import { describe, test, expect, beforeEach } from 'vitest';
import { handleExportBpmn } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../helpers';

/**
 * SVG snapshot tests.
 *
 * Verify that SVG output for known diagrams doesn't regress unexpectedly.
 * Uses Vitest inline snapshots / file snapshots so reviewers can diff
 * visual changes in pull requests.
 */
describe('export_bpmn — SVG snapshots', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  /**
   * Normalise volatile attributes that differ across runs (IDs embedded
   * inside `id="..."`, `xlink:href`, timestamps, etc.) so snapshots
   * are deterministic.
   */
  function normaliseSvg(svg: string): string {
    return (
      svg
        // Strip XML declaration if present
        .replace(/<\?xml[^?]*\?>\s*/, '')
        // Normalise generated element IDs (e.g. id="sid-abc123") — keep id attr, blank value
        .replace(/id="[^"]*"/g, 'id="<ID>"')
        // Normalise xlink:href references
        .replace(/xlink:href="#[^"]*"/g, 'xlink:href="#<REF>"')
        // Normalise marker references in style/url(#...)
        .replace(/url\(#[^)]*\)/g, 'url(#<REF>)')
        // Normalise data-element-id attributes
        .replace(/data-element-id="[^"]*"/g, 'data-element-id="<ID>"')
    );
  }

  // ── Minimal diagram: just a start event ──────────────────────────────

  test('empty process SVG has expected structure', async () => {
    const diagramId = await createDiagram('Snapshot Empty');
    const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
    const svg = normaliseSvg(res.content[0].text);

    // SVG should contain a root <svg> element
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toMatchSnapshot();
  });

  // ── Simple flow: Start → Task → End ──────────────────────────────────

  test('Start → Task → End SVG matches snapshot', async () => {
    const diagramId = await createDiagram('Snapshot Simple');
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Begin',
      x: 100,
      y: 200,
    });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Do Work',
      x: 280,
      y: 200,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      x: 460,
      y: 200,
    });
    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
    const svg = normaliseSvg(res.content[0].text);

    // In headless mode, labels are rendered as per-character <tspan> elements,
    // so we verify structure rather than full text strings.
    expect(svg).toContain('djs-label');
    expect(svg).toContain('djs-group');
    expect(svg).toMatchSnapshot();
  });

  // ── Gateway branch: Start → GW → [A, B] → Join → End ────────────────

  test('exclusive gateway branch SVG matches snapshot', async () => {
    const diagramId = await createDiagram('Snapshot Gateway');
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 200,
    });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Check',
      x: 250,
      y: 200,
    });
    const taskA = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Path A',
      x: 400,
      y: 100,
    });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Path B',
      x: 400,
      y: 300,
    });
    const join = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Merge',
      x: 550,
      y: 200,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 700,
      y: 200,
    });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskA, { label: 'Yes', conditionExpression: '${approved}' });
    await connect(diagramId, gw, taskB, { label: 'No', isDefault: true });
    await connect(diagramId, taskA, join);
    await connect(diagramId, taskB, join);
    await connect(diagramId, join, end);

    const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
    const svg = normaliseSvg(res.content[0].text);

    // Verify labels and connections are present (per-character tspans in headless mode)
    expect(svg).toContain('djs-label');
    expect(svg).toContain('djs-connection');
    expect(svg).toMatchSnapshot();
  });

  // ── SVG structure assertions (not snapshot, just invariants) ──────────

  test('SVG contains expected BPMN visual markers', async () => {
    const diagramId = await createDiagram('Markers');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 200 });
    const task = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Service',
      x: 280,
      y: 200,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { x: 460, y: 200 });
    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
    const svg = res.content[0].text;

    // Basic SVG structure
    expect(svg).toMatch(/<svg[^>]*xmlns/);
    // Should contain connection paths (sequence flows)
    expect(svg).toContain('<path');
    // Should contain circle or ellipse for events
    expect(svg).toMatch(/<circle|<ellipse/);
    // Should contain rect for tasks
    expect(svg).toContain('<rect');
  });
});
