/**
 * Tests for new tools: insert_bpmn_element, replace_bpmn_element,
 * summarize_bpmn_diagram, and bulk delete_bpmn_element.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { handleInsertElement } from '../../src/handlers/insert-element';
import { handleReplaceElement } from '../../src/handlers/replace-element';
import { handleSummarizeDiagram } from '../../src/handlers/summarize-diagram';
import { handleDeleteElement } from '../../src/handlers/delete-element';
import { handleConnect } from '../../src/handlers/connect';
import { handleListElements } from '../../src/handlers/list-elements';
import { handleAddElement } from '../../src/handlers/add-element';
import { clearDiagrams } from '../../src/diagram-manager';
import { parseResult, createDiagram, addElement } from '../helpers';

afterEach(() => clearDiagrams());

describe('insert_bpmn_element', () => {
  it('should insert an element into a sequence flow', async () => {
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

  it('should reject non-SequenceFlow elements', async () => {
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

  it('should reject non-insertable element types', async () => {
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

describe('replace_bpmn_element', () => {
  it('should replace element type preserving connections', async () => {
    const diagramId = await createDiagram('replace-test');

    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Do Work',
      x: 300,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 500,
      y: 100,
    });

    await handleConnect({ diagramId, sourceElementId: startId, targetElementId: taskId });
    await handleConnect({ diagramId, sourceElementId: taskId, targetElementId: endId });

    // Replace Task → UserTask
    const replaceResult = parseResult(
      await handleReplaceElement({
        diagramId,
        elementId: taskId,
        newType: 'bpmn:UserTask',
      })
    );
    expect(replaceResult.success).toBe(true);
    expect(replaceResult.newType).toBe('bpmn:UserTask');
    expect(replaceResult.oldType).toBe('bpmn:Task');

    // Verify the replacement has connections
    const elements = parseResult(await handleListElements({ diagramId }));
    const userTask = elements.elements.find((el: any) => el.type === 'bpmn:UserTask');
    expect(userTask).toBeDefined();
    expect(userTask.incoming).toBeDefined();
    expect(userTask.outgoing).toBeDefined();
  });

  it('should no-op when replacing to same type', async () => {
    const diagramId = await createDiagram('replace-noop');
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Test' });

    const result = parseResult(
      await handleReplaceElement({
        diagramId,
        elementId: taskId,
        newType: 'bpmn:UserTask',
      })
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('no change needed');
  });
});

describe('summarize_bpmn_diagram', () => {
  it('should return a summary of the diagram', async () => {
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

  it('should report disconnected elements', async () => {
    const diagramId = await createDiagram('summary-disconnected');

    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Orphan', x: 500, y: 100 });

    const summary = parseResult(await handleSummarizeDiagram({ diagramId }));
    expect(summary.disconnectedCount).toBeGreaterThanOrEqual(1);
  });
});

describe('delete_bpmn_element bulk mode', () => {
  it('should delete multiple elements at once', async () => {
    const diagramId = await createDiagram('bulk-delete');

    const id1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T1' });
    const id2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T2', x: 300, y: 100 });
    const id3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T3', x: 500, y: 100 });

    const deleteResult = parseResult(
      await handleDeleteElement({
        diagramId,
        elementId: '', // ignored in bulk mode
        elementIds: [id1, id2, id3],
      } as any)
    );
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.deletedCount).toBe(3);
    expect(deleteResult.deletedIds).toContain(id1);
    expect(deleteResult.deletedIds).toContain(id2);
    expect(deleteResult.deletedIds).toContain(id3);
  });

  it('should handle partial not-found in bulk delete', async () => {
    const diagramId = await createDiagram('bulk-partial');

    const id1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Exists' });

    const deleteResult = parseResult(
      await handleDeleteElement({
        diagramId,
        elementId: '',
        elementIds: [id1, 'nonexistent_id'],
      } as any)
    );
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.deletedCount).toBe(1);
    expect(deleteResult.notFound).toContain('nonexistent_id');
  });

  it('should reject when all elements not found', async () => {
    const diagramId = await createDiagram('bulk-all-missing');

    await expect(
      handleDeleteElement({
        diagramId,
        elementId: '',
        elementIds: ['nonexistent_1', 'nonexistent_2'],
      } as any)
    ).rejects.toThrow(/None of the specified elements/);
  });
});

describe('add_bpmn_element with autoConnect', () => {
  it('should auto-connect when using afterElementId', async () => {
    const diagramId = await createDiagram('autoconnect-test');

    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const addResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Auto Connected',
        afterElementId: startId,
      })
    );
    expect(addResult.success).toBe(true);
    expect(addResult.autoConnected).toBe(true);
    expect(addResult.connectionId).toBeDefined();
  });

  it('should skip auto-connect when autoConnect is false', async () => {
    const diagramId = await createDiagram('no-autoconnect');

    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const addResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'No Connect',
        afterElementId: startId,
        autoConnect: false,
      } as any)
    );
    expect(addResult.success).toBe(true);
    expect(addResult.autoConnected).toBeUndefined();
  });
});
