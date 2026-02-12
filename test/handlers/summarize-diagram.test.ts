/**
 * Tests for summarize_bpmn_diagram tool.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { handleSummarizeDiagram } from '../../src/handlers/summarize-diagram';
import { clearDiagrams } from '../../src/diagram-manager';
import { parseResult, createDiagram, addElement } from '../helpers';

afterEach(() => clearDiagrams());

describe('summarize_bpmn_diagram', () => {
  test('should return a summary of the diagram', async () => {
    const diagramId = await createDiagram('summary-test');

    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const summary = parseResult(await handleSummarizeDiagram({ diagramId }));
    expect(summary.success).toBe(true);
    expect(summary.totalElements).toBeGreaterThanOrEqual(4);
    expect(summary.flowElementCount).toBeGreaterThanOrEqual(4);
    expect(summary.namedElements).toBeDefined();
    expect(summary.namedElements.length).toBeGreaterThanOrEqual(4);
    expect(summary.elementCounts['bpmn:UserTask']).toBe(1);
    expect(summary.elementCounts['bpmn:ServiceTask']).toBe(1);
  });

  test('should report disconnected elements', async () => {
    const diagramId = await createDiagram('summary-disconnected');

    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Orphan', x: 500, y: 100 });

    const summary = parseResult(await handleSummarizeDiagram({ diagramId }));
    expect(summary.disconnectedCount).toBeGreaterThanOrEqual(1);
  });
});
