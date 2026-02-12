/**
 * Tests for export_bpmn lintMinSeverity parameter.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleExportBpmn } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../helpers';

describe('export_bpmn — lintMinSeverity', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('blocks export on warnings when lintMinSeverity is warning', async () => {
    const diagramId = await createDiagram();
    // Create a minimal valid flow (start -> end) but without labels
    // label-required is downgraded to 'warn' by default config
    const start = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { x: 300, y: 100 });
    await connect(diagramId, start, end);

    const res = await handleExportBpmn({
      diagramId,
      format: 'xml',
      lintMinSeverity: 'warning',
    });

    // Should be blocked due to warnings (label-required, no-disconnected, etc.)
    expect(res.content[0].text).toContain('Export blocked');
  });

  test('exports successfully at default error severity with warnings present', async () => {
    const diagramId = await createDiagram();
    // Create minimal valid flow - no lint errors but has warnings (no labels)
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 100,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 300,
      y: 100,
    });
    await connect(diagramId, start, end);

    const res = await handleExportBpmn({
      diagramId,
      format: 'xml',
      // Default lintMinSeverity is 'error'
    });

    // Should export - only errors block by default
    expect(res.content[0].text).toContain('<bpmn:definitions');
  });
});
