/**
 * Tests for moddle-utils: upsertExtensionElement, createBusinessObject, fixConnectionId.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  upsertExtensionElement,
  createBusinessObject,
  fixConnectionId,
} from '../../../src/handlers/moddle-utils';
import { createDiagram, addElement, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('moddle-utils', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('createBusinessObject', () => {
    test('creates a business object with the specified ID', async () => {
      const id = await createDiagram();
      const diagram = getDiagram(id)!;

      const bo = createBusinessObject(diagram.modeler, 'bpmn:UserTask', 'MyTask_42');
      expect(bo).toBeDefined();
      expect(bo.id).toBe('MyTask_42');
      expect(bo.$type).toBe('bpmn:UserTask');
    });
  });

  describe('fixConnectionId', () => {
    test('fixes mismatched business object ID', () => {
      const mockConnection = {
        businessObject: { id: 'auto_generated_123' },
      };

      fixConnectionId(mockConnection, 'Flow_Approve');
      expect(mockConnection.businessObject.id).toBe('Flow_Approve');
    });

    test('no-ops when IDs already match', () => {
      const mockConnection = {
        businessObject: { id: 'Flow_Approve' },
      };

      fixConnectionId(mockConnection, 'Flow_Approve');
      expect(mockConnection.businessObject.id).toBe('Flow_Approve');
    });

    test('handles connection without business object gracefully', () => {
      const mockConnection = { businessObject: undefined };
      // Should not throw
      expect(() => fixConnectionId(mockConnection as any, 'Flow_1')).not.toThrow();
    });
  });

  describe('upsertExtensionElement', () => {
    test('adds extension element to existing extensionElements', async () => {
      const id = await createDiagram();
      const taskId = await addElement(id, 'bpmn:UserTask', { name: 'Test' });
      const diagram = getDiagram(id)!;
      const moddle = diagram.modeler.get('moddle');
      const modeling = diagram.modeler.get('modeling');
      const registry = diagram.modeler.get('elementRegistry');
      const element = registry.get(taskId);
      const bo = element.businessObject;

      // Create a FormData element
      const formData = moddle.create('camunda:FormData', {
        fields: [moddle.create('camunda:FormField', { id: 'name', label: 'Name', type: 'string' })],
      });

      upsertExtensionElement(moddle, bo, modeling, element, 'camunda:FormData', formData);

      // Verify extension element was added
      const extensions = bo.extensionElements?.values || [];
      const found = extensions.find((v: any) => v.$type === 'camunda:FormData');
      expect(found).toBeDefined();
    });

    test('replaces existing extension element of same type', async () => {
      const id = await createDiagram();
      const taskId = await addElement(id, 'bpmn:UserTask', { name: 'Test' });
      const diagram = getDiagram(id)!;
      const moddle = diagram.modeler.get('moddle');
      const modeling = diagram.modeler.get('modeling');
      const registry = diagram.modeler.get('elementRegistry');
      const element = registry.get(taskId);
      const bo = element.businessObject;

      // Add first FormData
      const formData1 = moddle.create('camunda:FormData', {
        fields: [
          moddle.create('camunda:FormField', { id: 'first', label: 'First', type: 'string' }),
        ],
      });
      upsertExtensionElement(moddle, bo, modeling, element, 'camunda:FormData', formData1);

      // Add second FormData (should replace first)
      const formData2 = moddle.create('camunda:FormData', {
        fields: [
          moddle.create('camunda:FormField', { id: 'second', label: 'Second', type: 'string' }),
        ],
      });
      upsertExtensionElement(moddle, bo, modeling, element, 'camunda:FormData', formData2);

      // Should only have one FormData
      const extensions = bo.extensionElements?.values || [];
      const formDatas = extensions.filter((v: any) => v.$type === 'camunda:FormData');
      expect(formDatas).toHaveLength(1);
      expect(formDatas[0].fields[0].id).toBe('second');
    });
  });
});
