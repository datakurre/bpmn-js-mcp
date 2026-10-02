/**
 * Tests for add_bpmn_elements improvements:
 * 1. When chain stops at a gateway, the response should include:
 *    - The IDs of already-created flows that lack conditions
 *    - A hint about setting isDefault on the default branch
 * 2. When pool has lanes but no laneId specified, the warning should
 *    include a concrete nextSteps entry (not just a warning string).
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleAddElementChain,
  handleCreateParticipant,
  handleCreateLanes,
} from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('add_bpmn_elements — gateway hints and lane nextSteps', () => {
  beforeEach(() => clearDiagrams());

  test('lists unconditioned flow IDs after gateway stop', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        afterElementId: startId,
        elements: [
          { elementType: 'bpmn:UserTask', name: 'Enter Order' },
          { elementType: 'bpmn:ExclusiveGateway', name: 'Payment Required?' },
          { elementType: 'bpmn:ServiceTask', name: 'Process Payment' },
        ],
      })
    );

    expect(res.success).toBe(true);
    // Chain stops after gateway — last element may be unconnected
    expect(res.deferredLayout).toBe(true);

    // The note should mention isDefault
    expect(res.note).toMatch(/isDefault/i);

    // Should list flow IDs that are already created but lack conditions
    // (the flow from gateway to the element before it stops)
    expect(res.unconditionedFlowIds).toBeDefined();
    expect(Array.isArray(res.unconditionedFlowIds)).toBe(true);
  });

  test('lane warning includes concrete nextSteps entry when pool has lanes but no laneId', async () => {
    const diagramId = await createDiagram();
    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Pool', height: 300 })
    );
    await handleCreateLanes({
      diagramId,
      participantId: poolRes.participantId,
      lanes: [{ name: 'Customer' }, { name: 'Store' }],
    });

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        participantId: poolRes.participantId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Enter Order' },
        ],
      })
    );

    expect(res.success).toBe(true);
    // Should have a nextSteps entry (not just a warnings string) about laneId
    expect(res.nextSteps).toBeDefined();
    const laneStep = (res.nextSteps as any[]).find((s: any) => /laneId/i.test(s.description || ''));
    expect(laneStep).toBeDefined();
  });
});
