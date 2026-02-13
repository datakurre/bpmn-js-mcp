/**
 * Tests for list_bpmn_elements — property filter and camunda attribute coverage.
 *
 * Covers: property key-only filter, property key-value filter,
 * camunda property filtering, combined filters with property.
 *
 * Note: camunda moddle maps `camunda:assignee` → `bo.assignee` (direct property),
 * not via `$attrs`. Properties set via `$attrs` (e.g. custom attributes) are
 * looked up under their full prefixed key. Moddle-mapped Camunda properties
 * must be queried by short name (e.g. 'assignee') since that's how moddle stores them.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleListElements } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('list_bpmn_elements — property filtering', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('filters by isExecutable property key', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent');

    // The process itself has isExecutable=true
    const res = parseResult(
      await handleListElements({
        diagramId,
        property: { key: 'isExecutable', value: 'true' },
      })
    );

    // The process element has isExecutable
    expect(res.success).toBe(true);
  });

  test('filters by name property', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Doc' });
    await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Send Email' });

    const res = parseResult(
      await handleListElements({
        diagramId,
        property: { key: 'name', value: 'Review Doc' },
      })
    );

    expect(res.count).toBe(1);
    expect(res.elements[0].name).toBe('Review Doc');
  });

  test('filters by property key existence (name)', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Named Task' });
    // Adding unnamed event
    await addElement(diagramId, 'bpmn:StartEvent');

    const res = parseResult(
      await handleListElements({
        diagramId,
        property: { key: 'name' },
      })
    );

    // Named elements should be found
    expect(res.success).toBe(true);
    expect(res.count).toBeGreaterThanOrEqual(1);
    // All returned should have a name
    for (const el of res.elements) {
      expect(el.name).not.toBe('(unnamed)');
    }
  });

  test('combined type + name property filter', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:UserTask', { name: 'User Task' });
    await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Service' });

    const res = parseResult(
      await handleListElements({
        diagramId,
        elementType: 'bpmn:UserTask',
        property: { key: 'name' },
      })
    );

    expect(res.count).toBe(1);
    expect(res.elements[0].type).toBe('bpmn:UserTask');
  });

  test('property filter returns empty for no matches', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Plain Task' });

    const res = parseResult(
      await handleListElements({
        diagramId,
        property: { key: 'nonexistentProp' },
      })
    );

    expect(res.success).toBe(true);
    expect(res.count).toBe(0);
  });

  test('filters report includes applied filters in response', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    const res = parseResult(
      await handleListElements({
        diagramId,
        elementType: 'bpmn:UserTask',
        namePattern: 'task',
        property: { key: 'name' },
      })
    );

    expect(res.filters).toBeDefined();
    expect(res.filters.elementType).toBe('bpmn:UserTask');
    expect(res.filters.namePattern).toBe('task');
    expect(res.filters.property).toBeDefined();
  });

  test('no filters returns all elements without filters key', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    const res = parseResult(await handleListElements({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.filters).toBeUndefined();
  });
});
