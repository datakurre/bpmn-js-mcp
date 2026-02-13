/**
 * Tests for id-generation: generateDescriptiveId, generateFlowId.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { generateDescriptiveId, generateFlowId } from '../../../src/handlers/id-generation';
import { createDiagram, addElement, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('id-generation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('generateDescriptiveId', () => {
    test('generates 2-part ID for named element', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = generateDescriptiveId(registry, 'bpmn:UserTask', 'Enter Name');
      expect(result).toBe('UserTask_EnterName');
    });

    test('generates random ID for unnamed element', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = generateDescriptiveId(registry, 'bpmn:StartEvent');
      expect(result).toMatch(/^StartEvent_[a-z0-9]{7}$/);
    });

    test('falls back to 3-part ID on collision', async () => {
      const id = await createDiagram();
      // Create an element that takes the 2-part ID
      await addElement(id, 'bpmn:UserTask', { name: 'Enter Name' });
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      // Should produce a 3-part ID since UserTask_EnterName is taken
      const result = generateDescriptiveId(registry, 'bpmn:UserTask', 'Enter Name');
      expect(result).toMatch(/^UserTask_[a-z0-9]{7}_EnterName$/);
    });

    test('handles special characters in names', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = generateDescriptiveId(registry, 'bpmn:ServiceTask', 'Send E-mail!');
      expect(result).toBe('ServiceTask_SendEmail');
    });

    test('uses correct prefix for gateway types', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result1 = generateDescriptiveId(registry, 'bpmn:ExclusiveGateway', 'Approved?');
      expect(result1).toBe('Gateway_Approved');

      const result2 = generateDescriptiveId(registry, 'bpmn:ParallelGateway', 'Split');
      expect(result2).toBe('Gateway_Split');
    });

    test('uses correct prefix for SubProcess', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = generateDescriptiveId(registry, 'bpmn:SubProcess', 'Handle Order');
      expect(result).toBe('SubProcess_HandleOrder');
    });

    test('uses correct prefix for annotations and data objects', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const ann = generateDescriptiveId(registry, 'bpmn:TextAnnotation', 'Note');
      expect(ann).toBe('Annotation_Note');

      const dobj = generateDescriptiveId(registry, 'bpmn:DataObjectReference', 'Order');
      expect(dobj).toBe('DataObject_Order');

      const dstore = generateDescriptiveId(registry, 'bpmn:DataStoreReference', 'DB');
      expect(dstore).toBe('DataStore_DB');
    });

    test('uses correct prefix for CallActivity', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = generateDescriptiveId(registry, 'bpmn:CallActivity', 'Sub Process');
      expect(result).toBe('CallActivity_SubProcess');
    });

    test('handles empty name string', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      // Empty string after stripping should produce random
      const result = generateDescriptiveId(registry, 'bpmn:UserTask', '   ');
      expect(result).toMatch(/^UserTask_[a-z0-9]{7}$/);
    });
  });

  describe('generateFlowId', () => {
    test('generates 2-part ID with label', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = generateFlowId(registry, undefined, undefined, 'Yes');
      expect(result).toBe('Flow_Yes');
    });

    test('generates 2-part ID from source/target names', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = generateFlowId(registry, 'Start', 'Review');
      expect(result).toBe('Flow_Start_to_Review');
    });

    test('prefers label over source/target names', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = generateFlowId(registry, 'Start', 'End', 'Approved');
      expect(result).toBe('Flow_Approved');
    });

    test('generates random ID when no names available', async () => {
      const id = await createDiagram();
      const registry = getDiagram(id)!.modeler.get('elementRegistry');

      const result = generateFlowId(registry);
      expect(result).toMatch(/^Flow_[a-z0-9]{7}$/);
    });

    test('falls back to 3-part ID on collision', async () => {
      const id = await createDiagram();
      const start = await addElement(id, 'bpmn:StartEvent', { name: 'Start' });
      const end = await addElement(id, 'bpmn:EndEvent', { name: 'End' });
      // Create a flow that takes the 2-part ID
      const { handleConnect } = await import('../../../src/handlers');
      await handleConnect({
        diagramId: id,
        sourceElementId: start,
        targetElementId: end,
        label: 'Done',
      });

      const registry = getDiagram(id)!.modeler.get('elementRegistry');
      // Now generating same label flow should get 3-part ID
      const result = generateFlowId(registry, undefined, undefined, 'Done');
      expect(result).toMatch(/^Flow_[a-z0-9]{7}_Done$/);
    });
  });
});
