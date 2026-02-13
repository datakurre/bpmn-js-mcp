/**
 * Tests for insert-element-helpers: detectOverlaps, resolveInsertionOverlaps,
 * buildInsertResult.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  detectOverlaps,
  buildInsertResult,
} from '../../../src/handlers/elements/insert-element-helpers';
import { handleInsertElement } from '../../../src/handlers';
import { createDiagram, addElement, connect, parseResult, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('insert-element-helpers', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('detectOverlaps', () => {
    test('returns empty when no overlaps exist', async () => {
      const id = await createDiagram();
      const task1 = await addElement(id, 'bpmn:UserTask', {
        name: 'T1',
        x: 100,
        y: 100,
      });
      const task2 = await addElement(id, 'bpmn:UserTask', {
        name: 'T2',
        x: 500,
        y: 500,
      });

      const registry = getDiagram(id)!.modeler.get('elementRegistry');
      const el1 = registry.get(task1);

      const overlaps = detectOverlaps(registry, el1);
      // task2 is far away, should not overlap
      const overlapIds = overlaps.map((o: any) => o.id);
      expect(overlapIds).not.toContain(task2);
    });

    test('detects overlapping elements', async () => {
      const id = await createDiagram();
      const task1 = await addElement(id, 'bpmn:UserTask', {
        name: 'T1',
        x: 100,
        y: 100,
      });
      const task2 = await addElement(id, 'bpmn:UserTask', {
        name: 'T2',
        x: 110, // overlapping position
        y: 110,
      });

      const registry = getDiagram(id)!.modeler.get('elementRegistry');
      const el1 = registry.get(task1);

      const overlaps = detectOverlaps(registry, el1);
      const overlapIds = overlaps.map((o: any) => o.id);
      expect(overlapIds).toContain(task2);
    });

    test('excludes sequence flows and infrastructure elements', async () => {
      const id = await createDiagram();
      const start = await addElement(id, 'bpmn:StartEvent', {
        x: 100,
        y: 100,
      });
      const task = await addElement(id, 'bpmn:UserTask', {
        name: 'T',
        x: 200,
        y: 100,
      });
      await connect(id, start, task);

      const registry = getDiagram(id)!.modeler.get('elementRegistry');
      const el = registry.get(start);

      const overlaps = detectOverlaps(registry, el);
      // No sequence flows or labels should be in overlaps
      expect(overlaps.every((o: any) => !o.type.includes('SequenceFlow'))).toBe(true);
    });
  });

  describe('buildInsertResult', () => {
    test('builds correct result structure with all fields', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = buildInsertResult({
        createdElement: { id: 'Task_1' },
        elementType: 'bpmn:UserTask',
        elementName: 'Review',
        midX: 300,
        midY: 200,
        flowId: 'Flow_1',
        conn1: { id: 'Flow_2' },
        conn2: { id: 'Flow_3' },
        sourceId: 'Start_1',
        targetId: 'End_1',
        shiftApplied: 0,
        overlaps: [],
        elementRegistry: registry,
      });

      expect(result.success).toBe(true);
      expect(result.elementId).toBe('Task_1');
      expect(result.elementType).toBe('bpmn:UserTask');
      expect(result.name).toBe('Review');
      expect(result.position).toEqual({ x: 300, y: 200 });
      expect(result.replacedFlowId).toBe('Flow_1');
      expect(result.newFlows).toHaveLength(2);
      expect(result.message).toContain('Review');
      expect(result.message).toContain('Start_1');
      expect(result.message).toContain('End_1');
      expect(result.nextSteps).toBeDefined();
    });

    test('includes shift info when elements were shifted', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = buildInsertResult({
        createdElement: { id: 'Task_1' },
        elementType: 'bpmn:ServiceTask',
        midX: 300,
        midY: 200,
        flowId: 'Flow_1',
        conn1: { id: 'Flow_2' },
        conn2: { id: 'Flow_3' },
        sourceId: 'Start_1',
        targetId: 'End_1',
        shiftApplied: 150,
        overlaps: [],
        elementRegistry: registry,
      });

      expect(result.shiftApplied).toBe(150);
      expect(result.shiftNote).toBeDefined();
    });

    test('includes overlap resolution info', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = buildInsertResult({
        createdElement: { id: 'Task_1' },
        elementType: 'bpmn:Task',
        midX: 300,
        midY: 200,
        flowId: 'Flow_1',
        conn1: { id: 'Flow_2' },
        conn2: { id: 'Flow_3' },
        sourceId: 'Start_1',
        targetId: 'End_1',
        shiftApplied: 0,
        overlaps: [{ id: 'Task_2' }, { id: 'Task_3' }],
        elementRegistry: registry,
      });

      expect(result.overlapResolution).toContain('2 overlap');
      expect(result.overlapResolution).toContain('Task_2');
    });

    test('includes flow label note when provided', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = buildInsertResult({
        createdElement: { id: 'Task_1' },
        elementType: 'bpmn:Task',
        midX: 300,
        midY: 200,
        flowId: 'Flow_1',
        conn1: { id: 'Flow_2' },
        conn2: { id: 'Flow_3' },
        sourceId: 'Start_1',
        targetId: 'End_1',
        shiftApplied: 0,
        overlaps: [],
        flowLabel: 'Yes',
        elementRegistry: registry,
      });

      expect(result.note).toContain('Yes');
    });
  });

  describe('insertElement end-to-end', () => {
    test('inserts element into a flow', async () => {
      const id = await createDiagram();
      const start = await addElement(id, 'bpmn:StartEvent', { name: 'Start' });
      const end = await addElement(id, 'bpmn:EndEvent', { name: 'End' });
      const flowId = await connect(id, start, end);

      const res = parseResult(
        await handleInsertElement({
          diagramId: id,
          flowId,
          elementType: 'bpmn:UserTask',
          name: 'Review',
        })
      );

      expect(res.success).toBe(true);
      expect(res.elementType).toBe('bpmn:UserTask');
      expect(res.name).toBe('Review');
      expect(res.newFlows).toHaveLength(2);
      expect(res.replacedFlowId).toBe(flowId);
    });
  });
});
