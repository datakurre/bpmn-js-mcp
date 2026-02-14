import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleSuggestPoolVsLanes,
  handleSetProperties,
} from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('suggest_bpmn_pool_vs_lanes', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('recommends lanes for a single-pool diagram', async () => {
    const diagramId = await createDiagram();

    const result = parseResult(await handleSuggestPoolVsLanes({ diagramId }));

    expect(result.recommendation).toBe('lanes');
    expect(result.confidence).toBe('high');
  });

  test('analyzes collaboration with role-named pools', async () => {
    const diagramId = await createDiagram();

    await handleCreateCollaboration({
      diagramId,
      participants: [{ name: 'Manager' }, { name: 'Employee' }],
    });

    const result = parseResult(await handleSuggestPoolVsLanes({ diagramId }));

    // Manager and Employee are role-like names → lanes
    expect(result.recommendation).toBe('lanes');
    expect(result.participantAnalysis).toHaveLength(2);
  });

  test('analyzes collaboration with system-named pools', async () => {
    const diagramId = await createDiagram();

    const _collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Order Service' }, { name: 'Payment Gateway' }],
      })
    );

    const result = parseResult(await handleSuggestPoolVsLanes({ diagramId }));

    // "Service" and "Gateway" are system-like names
    expect(result.participantAnalysis).toHaveLength(2);
    expect(result.indicators.separateOrganization.length).toBeGreaterThan(0);
  });

  test('detects shared candidateGroups namespace', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Department A' }, { name: 'Department B' }],
      })
    );

    const pool1Id = collab.participantIds[0];
    const pool2Id = collab.participantIds[1];

    // Add tasks with candidateGroups from same namespace
    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review',
        participantId: pool1Id,
      })
    ).elementId;

    await handleSetProperties({
      diagramId,
      elementId: task1,
      properties: { 'camunda:candidateGroups': 'org.acme.reviewers' },
    });

    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Approve',
        participantId: pool2Id,
      })
    ).elementId;

    await handleSetProperties({
      diagramId,
      elementId: task2,
      properties: { 'camunda:candidateGroups': 'org.acme.approvers' },
    });

    const result = parseResult(await handleSuggestPoolVsLanes({ diagramId }));

    expect(result.recommendation).toBe('lanes');
    expect(result.indicators.sameOrganization.length).toBeGreaterThan(0);
  });

  test('returns participant analysis details', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Reviewer' }, { name: 'Author' }],
      })
    );

    const poolId = collab.participantIds[0];

    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Review Document',
      participantId: poolId,
    });

    const result = parseResult(await handleSuggestPoolVsLanes({ diagramId }));

    expect(result.participantAnalysis).toHaveLength(2);
    const reviewer = result.participantAnalysis.find((a: any) => a.name === 'Reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer.taskCount).toBe(1);
    expect(reviewer.hasRealTasks).toBe(true);
  });
});
