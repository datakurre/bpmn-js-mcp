/**
 * Tests for diagram-access helpers: requireDiagram, requireElement,
 * jsonResult, getVisibleElements, buildElementCounts, buildConnectivityWarnings.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  getVisibleElements,
  buildElementCounts,
  buildConnectivityWarnings,
} from '../../../src/handlers/diagram-access';
import { createDiagram, addElement, connect, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('diagram-access helpers', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('requireDiagram returns diagram state for valid ID', async () => {
    const id = await createDiagram('Test');
    const diagram = requireDiagram(id);
    expect(diagram).toBeDefined();
    expect(diagram.modeler).toBeDefined();
  });

  test('requireDiagram throws for nonexistent ID', () => {
    expect(() => requireDiagram('nope')).toThrow(/Diagram not found/);
  });

  test('requireElement returns element for valid ID', async () => {
    const id = await createDiagram();
    const taskId = await addElement(id, 'bpmn:UserTask', { name: 'T' });
    const registry = getDiagram(id)!.modeler.get('elementRegistry');

    const el = requireElement(registry, taskId);
    expect(el).toBeDefined();
    expect(el.id).toBe(taskId);
  });

  test('requireElement throws for nonexistent element', async () => {
    const id = await createDiagram();
    const registry = getDiagram(id)!.modeler.get('elementRegistry');

    expect(() => requireElement(registry, 'nope')).toThrow(/Element not found/);
  });

  test('jsonResult wraps data in MCP format', () => {
    const data = { success: true, message: 'hello' };
    const result = jsonResult(data);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('hello');
  });

  test('getVisibleElements filters infrastructure elements', async () => {
    const id = await createDiagram();
    await addElement(id, 'bpmn:StartEvent', { name: 'S' });
    await addElement(id, 'bpmn:UserTask', { name: 'T' });
    const registry = getDiagram(id)!.modeler.get('elementRegistry');

    const visible = getVisibleElements(registry);
    // Should NOT contain root process/plane elements
    const types = visible.map((el: any) => el.type);
    expect(types).not.toContain('bpmn:Process');
    expect(types).toContain('bpmn:StartEvent');
    expect(types).toContain('bpmn:UserTask');
  });

  test('buildElementCounts returns correct counts', async () => {
    const id = await createDiagram();
    await addElement(id, 'bpmn:StartEvent');
    await addElement(id, 'bpmn:UserTask', { name: 'A' });
    await addElement(id, 'bpmn:UserTask', { name: 'B' });
    await addElement(id, 'bpmn:EndEvent');
    const registry = getDiagram(id)!.modeler.get('elementRegistry');

    const counts = buildElementCounts(registry);
    expect(counts.total).toBeGreaterThanOrEqual(4);
    expect(counts.tasks).toBeGreaterThanOrEqual(2);
    expect(counts.events).toBeGreaterThanOrEqual(2);
  });

  test('buildConnectivityWarnings warns for disconnected elements', async () => {
    const id = await createDiagram();
    await addElement(id, 'bpmn:StartEvent', { name: 'S' });
    await addElement(id, 'bpmn:UserTask', { name: 'T' });
    // Not connected!
    const registry = getDiagram(id)!.modeler.get('elementRegistry');

    const warnings = buildConnectivityWarnings(registry);
    // Should have warnings about disconnected elements
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  test('buildConnectivityWarnings returns empty for well-connected process', async () => {
    const id = await createDiagram();
    const start = await addElement(id, 'bpmn:StartEvent', { name: 'S' });
    const task = await addElement(id, 'bpmn:UserTask', { name: 'T' });
    const end = await addElement(id, 'bpmn:EndEvent', { name: 'E' });
    await connect(id, start, task);
    await connect(id, task, end);
    const registry = getDiagram(id)!.modeler.get('elementRegistry');

    const warnings = buildConnectivityWarnings(registry);
    expect(warnings.length).toBe(0);
  });
});
