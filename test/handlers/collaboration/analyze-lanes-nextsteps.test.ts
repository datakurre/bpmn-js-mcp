/**
 * Tests for analyze_bpmn_lanes suggest mode:
 * - Response should include a concrete nextSteps array with
 *   create_bpmn_lanes (assignments) calls that an AI agent can execute
 *   directly without re-deriving element/lane IDs.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleAnalyzeLanes, handleCreateParticipant } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('analyze_bpmn_lanes suggest — nextSteps with assign tool calls', () => {
  beforeEach(() => clearDiagrams());

  test('suggest mode includes nextSteps with create_bpmn_lanes (assignments) calls', async () => {
    const diagramId = await createDiagram();
    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Groceries', height: 400 })
    );
    const participantId = poolRes.participantId;

    // Add some tasks of different types
    await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId,
      x: 150,
      y: 200,
    });
    await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Enter Order',
      participantId,
      x: 300,
      y: 200,
    });
    await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Payment',
      participantId,
      x: 460,
      y: 200,
    });
    await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Collection Service',
      participantId,
      x: 620,
      y: 200,
    });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done', participantId, x: 780, y: 200 });

    const res = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
    );

    expect(res.suggestions).toBeDefined();
    expect(res.suggestions.length).toBeGreaterThan(0);

    // Must include nextSteps with assign calls
    expect(res.nextSteps).toBeDefined();
    expect(Array.isArray(res.nextSteps)).toBe(true);

    // No lanes yet: one step creates the lanes and assigns their elements
    const createStep = (res.nextSteps as any[]).find((s: any) => s.tool === 'create_bpmn_lanes');
    expect(createStep).toBeDefined();
    expect(createStep.args.distributeStrategy).toBe('manual');
    expect(createStep.args.lanes.length).toBeGreaterThanOrEqual(2);
    for (const lane of createStep.args.lanes) {
      expect(lane.elementIds.length).toBeGreaterThan(0);
    }
  });
});
