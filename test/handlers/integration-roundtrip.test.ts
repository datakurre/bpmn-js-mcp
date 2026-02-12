import { describe, test, expect, beforeEach } from 'vitest';
import { handleExportBpmn, handleImportXml, handleLintDiagram } from '../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams, connect } from '../helpers';

/**
 * Integration test: full round-trip through the BPMN pipeline.
 *
 * Creates a non-trivial process, exports it, re-imports it,
 * lints it, and verifies zero errors.
 */
describe('integration: full round-trip', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('create → export → re-import → lint with zero errors', async () => {
    // ── Step 1: Build a non-trivial diagram ────────────────────────────
    const diagramId = await createDiagram('Round Trip Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 200,
    });

    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review Order',
      x: 250,
      y: 200,
    });

    const gateway = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Approved?',
      x: 400,
      y: 200,
    });

    const approvedTask = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Payment',
      x: 550,
      y: 100,
    });

    const rejectedTask = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Notify Rejection',
      x: 550,
      y: 300,
    });

    const joinGateway = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Join',
      x: 700,
      y: 200,
    });

    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 850,
      y: 200,
    });

    // Connect the flow
    await connect(diagramId, start, task);
    await connect(diagramId, task, gateway);
    await connect(diagramId, gateway, approvedTask, {
      label: 'Yes',
      conditionExpression: '${approved}',
    });
    await connect(diagramId, gateway, rejectedTask, { label: 'No', isDefault: true });
    await connect(diagramId, approvedTask, joinGateway);
    await connect(diagramId, rejectedTask, joinGateway);
    await connect(diagramId, joinGateway, end);

    // ── Step 2: Export as XML ──────────────────────────────────────────
    const exportRes = await handleExportBpmn({
      diagramId,
      format: 'xml',
      skipLint: true,
    });
    const xml = exportRes.content[0].text;
    expect(xml).toContain('<bpmn:definitions');
    expect(xml).toContain('Review Order');
    expect(xml).toContain('Process Payment');
    expect(xml).toContain('Notify Rejection');
    expect(xml).toContain('bpmn:exclusiveGateway');

    // ── Step 3: Re-import the exported XML ─────────────────────────────
    const importRes = parseResult(await handleImportXml({ xml }));
    expect(importRes.success).toBe(true);
    const reimportedId = importRes.diagramId;

    // ── Step 4: Lint the re-imported diagram — should have zero errors ─
    const lintRes = parseResult(await handleLintDiagram({ diagramId: reimportedId }));
    const errors = (lintRes.issues || []).filter((i: any) => i.severity === 'error');
    expect(errors).toEqual([]);

    // ── Step 5: Export the re-imported diagram (without skipLint) ───────
    const reExportRes = await handleExportBpmn({
      diagramId: reimportedId,
      format: 'xml',
    });
    // Should export successfully (not blocked)
    expect(reExportRes.content[0].text).toContain('<bpmn:definitions');
  });
});
