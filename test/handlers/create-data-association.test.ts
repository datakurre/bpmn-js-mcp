import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateDataAssociation } from '../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../helpers';

describe('handleCreateDataAssociation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates a data association from data object to task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const dataId = await addElement(diagramId, 'bpmn:DataObjectReference', { name: 'Order' });

    const res = parseResult(
      await handleCreateDataAssociation({
        diagramId,
        sourceElementId: dataId,
        targetElementId: taskId,
      })
    );

    expect(res.success).toBe(true);
    expect(res.connectionId).toBeDefined();
  });

  test('creates a data association from task to data store', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Save' });
    const storeId = await addElement(diagramId, 'bpmn:DataStoreReference', { name: 'DB' });

    const res = parseResult(
      await handleCreateDataAssociation({
        diagramId,
        sourceElementId: taskId,
        targetElementId: storeId,
      })
    );

    expect(res.success).toBe(true);
    expect(res.connectionId).toBeDefined();
  });

  test('connects two non-data elements as SequenceFlow (no data elements involved)', async () => {
    const diagramId = await createDiagram();
    const task1 = await addElement(diagramId, 'bpmn:UserTask');
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask');

    const res = parseResult(
      await handleCreateDataAssociation({
        diagramId,
        sourceElementId: task1,
        targetElementId: task2,
      })
    );

    // With no data elements, connects as SequenceFlow through the unified connect handler
    expect(res.success).toBe(true);
    expect(res.connectionId).toBeDefined();
  });
});
