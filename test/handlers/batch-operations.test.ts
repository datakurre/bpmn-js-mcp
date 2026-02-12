import { describe, test, expect, beforeEach } from 'vitest';
import { handleBatchOperations } from '../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('batch_bpmn_operations', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('executes multiple operations sequentially', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleBatchOperations({
        operations: [
          {
            tool: 'add_bpmn_element',
            args: { diagramId, elementType: 'bpmn:StartEvent', name: 'Start' },
          },
          {
            tool: 'add_bpmn_element',
            args: { diagramId, elementType: 'bpmn:EndEvent', name: 'End' },
          },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(0);

    // Verify elements were actually created with short 2-part IDs (first use)
    const diagram = getDiagram(diagramId)!;
    const registry = diagram.modeler.get('elementRegistry');
    expect(registry.get('StartEvent_Start')).toBeDefined();
    expect(registry.get('EndEvent_End')).toBeDefined();
  });

  test('stops on first error by default', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleBatchOperations({
        operations: [
          {
            tool: 'add_bpmn_element',
            args: { diagramId, elementType: 'bpmn:StartEvent' },
          },
          {
            tool: 'delete_bpmn_element',
            args: { diagramId, elementId: 'nonexistent' },
          },
          {
            tool: 'add_bpmn_element',
            args: { diagramId, elementType: 'bpmn:EndEvent' },
          },
        ],
      })
    );

    expect(res.success).toBe(false);
    expect(res.succeeded).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.executed).toBe(2); // Third operation was not executed
  });

  test('continues on error when stopOnError is false', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleBatchOperations({
        operations: [
          {
            tool: 'add_bpmn_element',
            args: { diagramId, elementType: 'bpmn:StartEvent' },
          },
          {
            tool: 'delete_bpmn_element',
            args: { diagramId, elementId: 'nonexistent' },
          },
          {
            tool: 'add_bpmn_element',
            args: { diagramId, elementType: 'bpmn:EndEvent' },
          },
        ],
        stopOnError: false,
      })
    );

    expect(res.success).toBe(false);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.executed).toBe(3); // All operations executed
  });

  test('rejects nested batch operations', async () => {
    await expect(
      handleBatchOperations({
        operations: [
          {
            tool: 'batch_bpmn_operations',
            args: { operations: [] },
          },
        ],
      })
    ).rejects.toThrow(/Nested batch/);
  });

  test('rejects empty operations array', async () => {
    await expect(handleBatchOperations({ operations: [] })).rejects.toThrow(/non-empty/);
  });
});
