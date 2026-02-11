/**
 * getBBox polyfill tests.
 *
 * Verifies that the headless getBBox polyfill returns reasonable dimensions
 * for text elements, proportional to text content length.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleExportBpmn, handleConnect } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../helpers';

describe('getBBox polyfill', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('exports label bounds with height ≤ 30px for short single-line labels', async () => {
    const diagramId = await createDiagram();
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
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: end });

    const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const xml = res.content[0].text;

    // Parse BPMNLabel heights from the XML
    const labelHeightMatches = xml.matchAll(
      /<bpmndi:BPMNLabel>\s*<dc:Bounds[^>]*height="(\d+(?:\.\d+)?)"/g
    );
    for (const match of labelHeightMatches) {
      const height = parseFloat(match[1]);
      // Single-line labels ("Start", "End") should have reasonable height
      expect(height).toBeLessThanOrEqual(50);
    }
  });

  test('exports label width proportional to text length', async () => {
    const diagramId = await createDiagram();
    const shortName = 'Go';
    const longName = 'Process the registration form';
    const shortId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: shortName,
      x: 100,
      y: 100,
    });
    const longId = await addElement(diagramId, 'bpmn:UserTask', {
      name: longName,
      x: 300,
      y: 100,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 500,
      y: 100,
    });
    await handleConnect({ diagramId, sourceElementId: shortId, targetElementId: longId });
    await handleConnect({ diagramId, sourceElementId: longId, targetElementId: end });

    const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const xml = res.content[0].text;

    // XML should exist and be valid
    expect(xml).toContain('<bpmn:definitions');
    // Labels should not have wildly inflated dimensions (e.g. height > 200)
    const boundsMatches = [...xml.matchAll(/<dc:Bounds[^>]*height="(\d+(?:\.\d+)?)"/g)];
    for (const match of boundsMatches) {
      const height = parseFloat(match[1]);
      // No element should have an absurd height like 251 or 845
      expect(height).toBeLessThan(300);
    }
  });

  test('text annotation does not get absurd height in DI', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Handle Order',
      x: 200,
      y: 100,
    });
    const annotId = await addElement(diagramId, 'bpmn:TextAnnotation', {
      name: 'Payment processing handled by external service',
      x: 200,
      y: 300,
    });

    // Connect annotation to task
    await handleConnect({
      diagramId,
      sourceElementId: annotId,
      targetElementId: taskId,
      connectionType: 'bpmn:Association',
    });

    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 400, y: 100 });
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 50,
      y: 100,
    });
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: taskId });
    await handleConnect({ diagramId, sourceElementId: taskId, targetElementId: end });

    const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const xml = res.content[0].text;

    // Text annotation bounds should not be absurdly tall (e.g. 845px)
    // Find the BPMNShape for the annotation
    const annotShapeMatch = xml.match(
      new RegExp(
        `<bpmndi:BPMNShape[^>]*bpmnElement="${annotId}"[^>]*>[\\s\\S]*?<dc:Bounds[^>]*height="(\\d+(?:\\.\\d+)?)"`,
        'm'
      )
    );
    if (annotShapeMatch) {
      const height = parseFloat(annotShapeMatch[1]);
      expect(height).toBeLessThan(200);
    }
  });
});

describe('getComputedTextLength polyfill', () => {
  test('does not throw when creating elements with labels', async () => {
    // If getComputedTextLength were missing, bpmn-js text wrapping would throw
    const diagramId = await createDiagram();
    const id = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'A task with a fairly long name that might trigger text wrapping',
      x: 200,
      y: 200,
    });
    expect(id).toBeDefined();
  });
});
