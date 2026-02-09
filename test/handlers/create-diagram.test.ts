import { describe, it, expect, beforeEach } from 'vitest';
import { handleCreateDiagram, handleExportBpmn, handleLintDiagram } from '../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../helpers';

describe('handleCreateDiagram', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('returns success with a diagramId', async () => {
    const res = parseResult(await handleCreateDiagram({}));
    expect(res.success).toBe(true);
    expect(res.diagramId).toMatch(/^diagram_/);
  });

  it('sets process name when provided', async () => {
    const diagramId = await createDiagram('My Process');
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('My Process');
  });

  it('sets a meaningful process id based on the name', async () => {
    const diagramId = await createDiagram('Order Fulfillment');
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('id="Process_Order_Fulfillment"');
    expect(xml).toContain('Order Fulfillment');
  });

  it('does not change process id when no name is provided', async () => {
    const diagramId = await createDiagram();
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('id="Process_1"');
  });

  it('sets camunda:historyTimeToLive on the process', async () => {
    const diagramId = await createDiagram('HTL Test');
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:historyTimeToLive="P180D"');
  });

  it('historyTimeToLive is present even without a name', async () => {
    const diagramId = await createDiagram();
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:historyTimeToLive="P180D"');
  });

  it('lint does not warn about missing historyTimeToLive on new diagram', async () => {
    const diagramId = await createDiagram('Lint HTL Test');
    const lintRes = parseResult(await handleLintDiagram({ diagramId }));
    const htlIssues = (lintRes.issues || []).filter(
      (i: any) => i.rule && i.rule.includes('history-time-to-live')
    );
    expect(htlIssues).toEqual([]);
  });
});
