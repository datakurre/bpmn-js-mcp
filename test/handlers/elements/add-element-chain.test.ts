import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleAddElementChain,
  handleCreateCollaboration,
  handleCreateParticipant,
  handleCreateLanes,
} from '../../../src/handlers';
import { createDiagram, parseResult, addElement, clearDiagrams } from '../../helpers';

describe('add_bpmn_elements', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates a linear chain of elements', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Review' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(3);
    expect(res.elementIds).toHaveLength(3);
    // First element has no connection (no afterElementId), subsequent ones do
    expect(res.elements[0].connectionId).toBeUndefined();
    expect(res.elements[1].connectionId).toBeDefined();
    expect(res.elements[2].connectionId).toBeDefined();
  });

  test('connects chain after an existing element', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        afterElementId: startId,
        elements: [
          { elementType: 'bpmn:UserTask', name: 'Task 1' },
          { elementType: 'bpmn:UserTask', name: 'Task 2' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(3);
    // First element should be connected to afterElement
    expect(res.elements[0].connectionId).toBeDefined();
    expect(res.elements[1].connectionId).toBeDefined();
    expect(res.elements[2].connectionId).toBeDefined();
  });

  test('rejects empty elements array', async () => {
    const diagramId = await createDiagram();

    await expect(
      handleAddElementChain({
        diagramId,
        elements: [],
      })
    ).rejects.toThrow(/Missing required/);
  });

  test('rejects invalid element type', async () => {
    const diagramId = await createDiagram();

    await expect(
      handleAddElementChain({
        diagramId,
        elements: [{ elementType: 'bpmn:NotAType' }],
      })
    ).rejects.toThrow();
  });

  test('creates single element chain', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [{ elementType: 'bpmn:UserTask', name: 'Solo Task' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(1);
    expect(res.elementIds).toHaveLength(1);
  });

  test('includes element names in message', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Begin' },
          { elementType: 'bpmn:ServiceTask', name: 'Process' },
          { elementType: 'bpmn:EndEvent', name: 'Done' },
        ],
      })
    );

    expect(res.message).toContain('Begin');
    expect(res.message).toContain('Process');
    expect(res.message).toContain('Done');
  });

  test('validates all element types before creating any', async () => {
    const diagramId = await createDiagram();

    // Second element has invalid type - should fail before creating first
    await expect(
      handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:InvalidType' as any, name: 'Bad' },
        ],
      })
    ).rejects.toThrow();
  });

  test('rejects EndEvent in middle of chain', async () => {
    const diagramId = await createDiagram();

    await expect(
      handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
          { elementType: 'bpmn:UserTask', name: 'After End' },
        ],
      })
    ).rejects.toThrow(/EndEvent is a flow sink/);
  });

  test('rejects afterElementId pointing to EndEvent', async () => {
    const diagramId = await createDiagram();
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await expect(
      handleAddElementChain({
        diagramId,
        afterElementId: endId,
        elements: [{ elementType: 'bpmn:UserTask', name: 'After End' }],
      })
    ).rejects.toThrow(/EndEvent is a flow sink/);
  });

  test('allows EndEvent as last element in chain', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Task' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(3);
  });

  test('stops auto-connecting elements after a gateway in chain', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Prepare' },
          { elementType: 'bpmn:ParallelGateway', name: 'Fork' },
          { elementType: 'bpmn:ServiceTask', name: 'Branch A' },
          { elementType: 'bpmn:UserTask', name: 'Branch B' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(5);
    expect(res.deferredLayout).toBe(true);

    // Elements after the gateway must NOT be auto-connected to each other
    // (Branch A and Branch B should be unconnected to chain)
    const branchA = res.elements.find((e: any) => e.name === 'Branch A');
    const branchB = res.elements.find((e: any) => e.name === 'Branch B');
    expect(branchA?.connectionId).toBeUndefined();
    expect(branchB?.connectionId).toBeUndefined();
  });

  test('includes unconnectedElements in response when chain has gateway', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:ExclusiveGateway', name: 'Decision' },
          { elementType: 'bpmn:UserTask', name: 'Option A' },
          { elementType: 'bpmn:UserTask', name: 'Option B' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.deferredLayout).toBe(true);
    expect(Array.isArray(res.unconnectedElements)).toBe(true);
    expect(res.unconnectedElements.length).toBe(2); // Option A and Option B
  });

  test('includes connectionIds map in response for linear chain', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Review' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.connectionIds).toBeDefined();
    // Two connections: Start→Review, Review→End
    const connIds = Object.values(res.connectionIds);
    expect(connIds.length).toBe(2);
    // Each connectionId should match the per-element connectionId
    const reviewEl = res.elements.find((e: any) => e.name === 'Review');
    const endEl = res.elements.find((e: any) => e.name === 'End');
    expect(res.connectionIds[reviewEl.elementId]).toBe(reviewEl.connectionId);
    expect(res.connectionIds[endEl.elementId]).toBe(endEl.connectionId);
  });

  test('warns when chain elements span different participantIds (cross-pool)', async () => {
    const diagramId = await createDiagram();

    const collResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Pool A', width: 600, height: 250 },
          { name: 'Pool B', width: 600, height: 250 },
        ],
      })
    );
    const poolAId = collResult.participantIds[0];
    const poolBId = collResult.participantIds[1];

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start', participantId: poolAId },
          { elementType: 'bpmn:UserTask', name: 'Task A', participantId: poolAId },
          // Cross-pool: this element's participantId differs from the previous
          { elementType: 'bpmn:ServiceTask', name: 'Task B', participantId: poolBId },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(Array.isArray(res.warnings)).toBe(true);
    const crossPoolWarning = res.warnings.find(
      (w: string) =>
        w.includes('cross-pool') || w.includes('different pool') || w.includes('wrong pool')
    );
    expect(crossPoolWarning).toBeDefined();
  });

  test('emits warning when participantId has lanes but no laneId is specified', async () => {
    // Regression for TODO #8: add_bpmn_elements should warn about missing laneId
    const diagramId = await createDiagram();

    const collResult = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'Company',
        width: 800,
        height: 400,
      })
    );
    const poolId = collResult.participantId as string;

    // Create lanes in the pool
    await handleCreateLanes({
      diagramId,
      participantId: poolId,
      lanes: [{ name: 'Engineering' }, { name: 'Management' }],
    });

    // Call chain with participantId but no laneId
    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        participantId: poolId,
        // No laneId — should warn
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Do Work' },
        ],
        autoLayout: false,
      })
    );

    expect(res.success).toBe(true);
    expect(Array.isArray(res.warnings)).toBe(true);
    const laneWarning = res.warnings.find(
      (w: string) => w.toLowerCase().includes('lane') && w.toLowerCase().includes('laneid')
    );
    expect(laneWarning).toBeDefined();
  });

  test('warns when no afterElementId provided in non-empty diagram', async () => {
    const diagramId = await createDiagram();
    // Add a start event first so the diagram is non-empty
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        // No afterElementId — should warn about disconnected chain
        elements: [
          { elementType: 'bpmn:UserTask', name: 'Task A' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
        autoLayout: false,
      })
    );

    expect(res.success).toBe(true);
    expect(Array.isArray(res.warnings)).toBe(true);
    const disconnectWarning = res.warnings.find((w: string) =>
      /disconnected|afterElementId/i.test(w)
    );
    expect(disconnectWarning).toBeDefined();
  });

  test('no disconnected warning when no afterElementId but diagram is empty', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        // No afterElementId — but diagram is empty, so no warning expected
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Task A' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
        autoLayout: false,
      })
    );

    expect(res.success).toBe(true);
    // Should not have a disconnected warning for a fresh/empty diagram
    if (res.warnings) {
      const disconnectWarning = res.warnings.find((w: string) =>
        /disconnected.*afterElementId|afterElementId.*disconnected/i.test(w)
      );
      expect(disconnectWarning).toBeUndefined();
    }
  });

  test('note includes unconnected element IDs when chain has gateway', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:ExclusiveGateway', name: 'Decision' },
          { elementType: 'bpmn:UserTask', name: 'Option A' },
          { elementType: 'bpmn:UserTask', name: 'Option B' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.note).toBeDefined();
    // The note should include the IDs of the unconnected elements
    for (const uc of res.unconnectedElements) {
      expect(res.note).toContain(uc.elementId);
    }
  });
});
