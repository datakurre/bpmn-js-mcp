/**
 * Tests for layout_bpmn_diagram dryRun option and export hint.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';

describe('layout_bpmn_diagram dryRun', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('dryRun returns displacement stats without modifying diagram', async () => {
    const diagramId = await createDiagram('DryRun Test');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 100,
    });
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Do Work',
      x: 100,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 100,
      y: 100,
    });
    await connect(diagramId, startId, taskId);
    await connect(diagramId, taskId, endId);

    // Dry run should return stats
    const dryResult = parseResult(await handleLayoutDiagram({ diagramId, dryRun: true }));
    expect(dryResult.success).toBe(true);
    expect(dryResult.dryRun).toBe(true);
    expect(dryResult.totalElements).toBeGreaterThanOrEqual(3);
    expect(typeof dryResult.movedCount).toBe('number');
    expect(typeof dryResult.maxDisplacement).toBe('number');
    expect(typeof dryResult.avgDisplacement).toBe('number');
    expect(dryResult.message).toContain('Dry run');
    expect(Array.isArray(dryResult.topDisplacements)).toBe(true);
  });

  test('dryRun does not actually modify element positions', async () => {
    const diagramId = await createDiagram('DryRun NoModify');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 150,
      y: 200,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 150,
      y: 200,
    });
    await connect(diagramId, startId, endId);

    // Get positions before dry run by doing a real export
    const { handleExportBpmn } = await import('../../../src/handlers');
    const beforeXml = (await handleExportBpmn({ diagramId, format: 'xml', skipLint: true }))
      .content[0].text;

    // Run dry run
    await handleLayoutDiagram({ diagramId, dryRun: true });

    // Get positions after dry run
    const afterXml = (await handleExportBpmn({ diagramId, format: 'xml', skipLint: true }))
      .content[0].text;

    // XML should be identical (positions unchanged)
    expect(afterXml).toBe(beforeXml);
  });

  test('dryRun detects elements that would move', async () => {
    const diagramId = await createDiagram('DryRun Moves');
    // Place all elements at same position so layout would definitely move them
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 100,
    });
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task',
      x: 100,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 100,
      y: 100,
    });
    await connect(diagramId, startId, taskId);
    await connect(diagramId, taskId, endId);

    const result = parseResult(await handleLayoutDiagram({ diagramId, dryRun: true }));
    expect(result.movedCount).toBeGreaterThan(0);
  });
});

describe('layout_bpmn_diagram export hint', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('includes export_bpmn in nextSteps after layout', async () => {
    const diagramId = await createDiagram('Export Hint Test');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 300,
      y: 100,
    });
    await connect(diagramId, startId, endId);

    const result = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(result.nextSteps).toBeDefined();
    expect(result.nextSteps.some((h: any) => h.tool === 'export_bpmn')).toBe(true);
  });

  test('dryRun does not include export hint', async () => {
    const diagramId = await createDiagram('DryRun No Hint');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 300,
      y: 100,
    });
    await connect(diagramId, startId, endId);

    const result = parseResult(await handleLayoutDiagram({ diagramId, dryRun: true }));
    // dryRun shouldn't have the export nextSteps since nothing was applied
    expect(result.nextSteps).toBeUndefined();
  });
});
