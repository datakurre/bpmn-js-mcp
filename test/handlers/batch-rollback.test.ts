import { describe, test, expect, beforeEach } from 'vitest';
import { handleBatchOperations } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('batch operations rollback', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('rolls back all changes on failure when stopOnError is true', async () => {
    const diagramId = await createDiagram('Rollback Test');

    // Add a start event first (pre-batch baseline)
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    // Verify baseline: one start event exists
    const diagram = getDiagram(diagramId)!;
    const registryBefore = diagram.modeler.get('elementRegistry');
    expect(registryBefore.get(startId)).toBeDefined();

    // Run batch: add a task, then fail
    const res = parseResult(
      await handleBatchOperations({
        operations: [
          {
            tool: 'add_bpmn_element',
            args: { diagramId, elementType: 'bpmn:UserTask', name: 'Should Be Rolled Back' },
          },
          {
            tool: 'delete_bpmn_element',
            args: { diagramId, elementId: 'nonexistent_element_xyz' },
          },
        ],
        stopOnError: true,
      })
    );

    expect(res.success).toBe(false);
    expect(res.rolledBack).toBe(true);

    // After rollback, the task added in the batch should be gone
    const registryAfter = diagram.modeler.get('elementRegistry');
    const taskElements = registryAfter.filter(
      (el: any) =>
        el.type === 'bpmn:UserTask' && el.businessObject?.name === 'Should Be Rolled Back'
    );
    expect(taskElements.length).toBe(0);

    // The pre-batch start event should still exist
    expect(registryAfter.get(startId)).toBeDefined();
  });

  test('does NOT roll back when stopOnError is false', async () => {
    const diagramId = await createDiagram('No Rollback');

    const res = parseResult(
      await handleBatchOperations({
        operations: [
          {
            tool: 'add_bpmn_element',
            args: { diagramId, elementType: 'bpmn:StartEvent', name: 'Kept' },
          },
          {
            tool: 'delete_bpmn_element',
            args: { diagramId, elementId: 'nonexistent_element_xyz' },
          },
          {
            tool: 'add_bpmn_element',
            args: { diagramId, elementType: 'bpmn:EndEvent', name: 'Also Kept' },
          },
        ],
        stopOnError: false,
      })
    );

    expect(res.success).toBe(false);
    expect(res.rolledBack).toBeUndefined();

    // Elements from successful operations should still exist
    const diagram = getDiagram(diagramId)!;
    const registry = diagram.modeler.get('elementRegistry');
    expect(registry.get('StartEvent_Kept')).toBeDefined();
    expect(registry.get('EndEvent_AlsoKept')).toBeDefined();
  });

  test('rollback message indicates all changes rolled back', async () => {
    const diagramId = await createDiagram('Rollback Msg');

    const res = parseResult(
      await handleBatchOperations({
        operations: [
          {
            tool: 'add_bpmn_element',
            args: { diagramId, elementType: 'bpmn:UserTask', name: 'Task' },
          },
          {
            tool: 'delete_bpmn_element',
            args: { diagramId, elementId: 'does_not_exist' },
          },
        ],
        stopOnError: true,
      })
    );

    expect(res.message).toContain('rolled back');
  });
});
