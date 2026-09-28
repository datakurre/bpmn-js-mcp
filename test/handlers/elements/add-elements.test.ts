/**
 * Tests for add_bpmn_elements — merges the former add_bpmn_element and
 * add_bpmn_element_chain tools (see ADR-031). `elements` is always an
 * array; `connect` picks 'chain' (default) or 'none'.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleAddElements,
  handleExportBpmn,
  handleListElements,
  dispatchToolCall,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('add_bpmn_elements', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── single-element case (parity with the former add_bpmn_element) ────────

  test('single-item array creates one element (default connect: chain is a no-op)', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElements({
        diagramId,
        elements: [{ elementType: 'bpmn:StartEvent', name: 'Begin', x: 150, y: 200 }],
      })
    );
    expect(res.success).toBe(true);
    expect(res.elementIds).toHaveLength(1);
    expect(res.elements[0].elementType).toBe('bpmn:StartEvent');
    expect(res.elements[0].name).toBe('Begin');
  });

  test('single-item array supports hostElementId (boundary event)', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Do it' });
    const res = parseResult(
      await handleAddElements({
        diagramId,
        elements: [{ elementType: 'bpmn:BoundaryEvent', hostElementId: taskId, name: 'Timeout' }],
      })
    );
    expect(res.success).toBe(true);
    expect(res.elements[0].elementType).toBe('bpmn:BoundaryEvent');
  });

  test('rejects an empty elements array', async () => {
    const diagramId = await createDiagram();
    await expect(handleAddElements({ diagramId, elements: [] })).rejects.toThrow(
      /Missing required/
    );
  });

  // ── connect: 'chain' (default, parity with the former add_bpmn_element_chain) ──

  test('connect: chain (default) auto-connects consecutive elements', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElements({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Review' },
          { elementType: 'bpmn:EndEvent', name: 'Done' },
        ],
      })
    );
    expect(res.success).toBe(true);
    expect(res.elementIds).toHaveLength(3);
    expect(Object.keys(res.connectionIds)).toHaveLength(2);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect((xml.match(/<bpmn:sequenceFlow/g) ?? []).length).toBe(2);
  });

  test('an item with its own anchor (hostElementId) is not auto-chained', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Do it' });
    const res = parseResult(
      await handleAddElements({
        diagramId,
        elements: [
          { elementType: 'bpmn:BoundaryEvent', hostElementId: taskId, name: 'Timeout' },
          { elementType: 'bpmn:EndEvent', name: 'Escalated' },
        ],
      })
    );
    expect(res.success).toBe(true);
    // The EndEvent should NOT be auto-connected from the boundary event via
    // a normal chain flow, since the boundary event has its own anchor.
    expect(res.connectionIds[res.elements[0].elementId]).toBeUndefined();
  });

  test('connect: chain respects afterElementId to attach to an existing element', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const res = parseResult(
      await handleAddElements({
        diagramId,
        elements: [{ elementType: 'bpmn:EndEvent', name: 'Done' }],
        afterElementId: startId,
      })
    );
    expect(res.success).toBe(true);
    expect(Object.keys(res.connectionIds)).toHaveLength(1);
  });

  // ── connect: 'none' ────────────────────────────────────────────────────

  test('connect: none adds every element independently, no auto-connection', async () => {
    const diagramId = await createDiagram();
    const gw = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Fork' });
    const res = parseResult(
      await handleAddElements({
        diagramId,
        connect: 'none',
        elements: [
          {
            elementType: 'bpmn:ServiceTask',
            name: 'Send Email',
            afterElementId: gw,
            autoConnect: false,
          },
          {
            elementType: 'bpmn:ServiceTask',
            name: 'Update Inventory',
            afterElementId: gw,
            autoConnect: false,
          },
        ],
      })
    );
    expect(res.success).toBe(true);
    expect(res.elementIds).toHaveLength(2);
    expect(res.message).toContain('connect: none');

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    // Neither task should be auto-connected to the other.
    expect(xml).not.toContain('Send Email" targetRef');
  });

  test('connect: none does not run autoLayout by default', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElements({
        diagramId,
        connect: 'none',
        elements: [{ elementType: 'bpmn:StartEvent' }],
      })
    );
    expect(res.autoLayoutApplied).toBeUndefined();
  });

  test('connect: none runs autoLayout when explicitly requested', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElements({
        diagramId,
        connect: 'none',
        autoLayout: true,
        elements: [{ elementType: 'bpmn:StartEvent' }],
      })
    );
    expect(res.autoLayoutApplied).toBe(true);
  });

  // ── dispatch-level coverage ────────────────────────────────────────────

  test('the old tool names are no longer registered', async () => {
    await expect(
      dispatchToolCall('add_bpmn_element', { elementType: 'bpmn:Task' })
    ).rejects.toThrow(/Unknown tool/);
    await expect(
      dispatchToolCall('add_bpmn_element_chain', { elements: [{ elementType: 'bpmn:Task' }] })
    ).rejects.toThrow(/Unknown tool/);
  });

  test('add_bpmn_elements is dispatchable via dispatchToolCall', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await dispatchToolCall('add_bpmn_elements', {
        diagramId,
        elements: [{ elementType: 'bpmn:StartEvent' }],
      })
    );
    expect(res.success).toBe(true);

    const list = parseResult(await handleListElements({ diagramId }));
    expect(list.count).toBeGreaterThan(0);
  });
});
