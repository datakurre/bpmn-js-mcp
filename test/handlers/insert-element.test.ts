/**
 * Tests for insert_bpmn_element tool.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { handleInsertElement } from '../../src/handlers/insert-element';
import { handleConnect } from '../../src/handlers/connect';
import { clearDiagrams } from '../../src/diagram-manager';
import { parseResult, createDiagram, addElement } from '../helpers';

afterEach(() => clearDiagrams());

describe('insert_bpmn_element', () => {
  test('should insert an element into a sequence flow', async () => {
    const diagramId = await createDiagram('insert-test');

    // Build a simple flow: Start → End
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 400,
      y: 100,
    });
    const connectResult = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: startId,
        targetElementId: endId,
      })
    );
    const flowId = connectResult.connectionId;

    // Insert a UserTask between Start and End
    const insertResult = parseResult(
      await handleInsertElement({
        diagramId,
        flowId,
        elementType: 'bpmn:UserTask',
        name: 'Review',
      })
    );
    expect(insertResult.success).toBe(true);
    expect(insertResult.elementType).toBe('bpmn:UserTask');
    expect(insertResult.newFlows).toHaveLength(2);
    expect(insertResult.newFlows[0].source).toBe(startId);
    expect(insertResult.newFlows[1].target).toBe(endId);
  });

  test('should reject non-SequenceFlow elements', async () => {
    const diagramId = await createDiagram('insert-test-2');
    const startId = await addElement(diagramId, 'bpmn:StartEvent');

    await expect(
      handleInsertElement({
        diagramId,
        flowId: startId,
        elementType: 'bpmn:UserTask',
      })
    ).rejects.toThrow(/not a SequenceFlow/);
  });

  test('should reject non-insertable element types', async () => {
    const diagramId = await createDiagram('insert-test-3');
    const startId = await addElement(diagramId, 'bpmn:StartEvent');
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { x: 400, y: 100 });
    const connectResult = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: startId,
        targetElementId: endId,
      })
    );

    await expect(
      handleInsertElement({
        diagramId,
        flowId: connectResult.connectionId,
        elementType: 'bpmn:Participant',
      })
    ).rejects.toThrow(/Cannot insert/);
  });
});
