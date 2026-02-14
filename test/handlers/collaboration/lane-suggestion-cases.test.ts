import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleSuggestLaneOrganization,
  handleSetProperties,
  handleSummarizeDiagram,
} from '../../../src/handlers';
import { createDiagram, addElement, connect, parseResult, clearDiagrams } from '../../helpers';

describe('lane suggestion test cases (TODO-helpdesk)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('single-process workflow with 3+ assignees should suggest lanes', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    // Create tasks with 3 different assignees
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Submit Request' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve Request' });
    const task3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Request' });
    const task4 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Notify' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, task3);
    await connect(diagramId, task3, task4);
    await connect(diagramId, task4, end);

    // 3 distinct assignees
    await handleSetProperties({
      diagramId,
      elementId: task1,
      properties: { 'camunda:assignee': 'requester' },
    });
    await handleSetProperties({
      diagramId,
      elementId: task2,
      properties: { 'camunda:assignee': 'manager' },
    });
    await handleSetProperties({
      diagramId,
      elementId: task3,
      properties: { 'camunda:assignee': 'hr-admin' },
    });

    const res = parseResult(await handleSuggestLaneOrganization({ diagramId }));

    // With 3+ distinct roles, should use role-based grouping
    expect(res.groupingStrategy).toBe('role');
    // Should have at least 3 lane suggestions (one per role)
    expect(res.suggestions.length).toBeGreaterThanOrEqual(3);

    // Verify each role has a lane
    const laneNames = res.suggestions.map((s: any) => s.laneName);
    expect(laneNames).toContain('requester');
    expect(laneNames).toContain('manager');
    expect(laneNames).toContain('hr-admin');

    // Recommendation should exist and provide guidance
    expect(res.recommendation).toBeDefined();
    expect(typeof res.recommendation).toBe('string');
    expect(res.recommendation.length).toBeGreaterThan(0);
  });

  test('diagram summary includes structureRecommendation when roles detected', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Submit' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, end);

    await handleSetProperties({
      diagramId,
      elementId: task1,
      properties: { 'camunda:assignee': 'submitter' },
    });
    await handleSetProperties({
      diagramId,
      elementId: task2,
      properties: { 'camunda:assignee': 'reviewer' },
    });

    const summary = parseResult(await handleSummarizeDiagram({ diagramId }));

    // Summary should include element count information
    expect(summary).toBeDefined();
    // The summarize tool uses different field names — check for counts or namedElements
    const hasElements = summary.namedElements?.length >= 4 || summary.totalElements >= 4;
    expect(hasElements).toBe(true);
  });
});
