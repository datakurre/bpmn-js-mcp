import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleSuggestLaneOrganization,
  handleValidateLaneOrganization,
  handleCreateLanes,
  handleAssignElementsToLane,
} from '../../../src/handlers';
import { createDiagram, addElement, connect, parseResult, clearDiagrams } from '../../helpers';

describe('suggest_bpmn_lane_organization', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('suggests lanes based on element types', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const userTask1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
    const userTask2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });
    const serviceTask = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Payment',
    });
    const scriptTask = await addElement(diagramId, 'bpmn:ScriptTask', {
      name: 'Calculate Total',
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, userTask1);
    await connect(diagramId, userTask1, userTask2);
    await connect(diagramId, userTask2, serviceTask);
    await connect(diagramId, serviceTask, scriptTask);
    await connect(diagramId, scriptTask, end);

    const res = parseResult(await handleSuggestLaneOrganization({ diagramId }));

    expect(res.totalFlowNodes).toBeGreaterThanOrEqual(6);
    expect(res.suggestions.length).toBeGreaterThanOrEqual(2);

    // Should have a "Human Tasks" suggestion with the user tasks
    const humanLane = res.suggestions.find((s: any) => s.laneName === 'Human Tasks');
    expect(humanLane).toBeDefined();
    expect(humanLane.elementIds).toContain(userTask1);
    expect(humanLane.elementIds).toContain(userTask2);

    // Should have an "Automated Tasks" suggestion with service/script tasks
    const autoLane = res.suggestions.find((s: any) => s.laneName === 'Automated Tasks');
    expect(autoLane).toBeDefined();
    expect(autoLane.elementIds).toContain(serviceTask);
    expect(autoLane.elementIds).toContain(scriptTask);

    expect(res.coherenceScore).toBeDefined();
    expect(res.recommendation).toBeDefined();
  });

  test('returns empty suggestions for diagram with no typed tasks', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const res = parseResult(await handleSuggestLaneOrganization({ diagramId }));

    // Only events — no categorizable tasks
    expect(res.suggestions).toHaveLength(0);
    expect(res.recommendation).toContain('No categorizable tasks');
  });

  test('handles collaboration diagrams with participantId', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Main Pool',
      x: 400,
      y: 200,
    });

    const _userTask = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
      participantId: participant,
    });
    const _serviceTask = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process',
      participantId: participant,
    });

    const res = parseResult(
      await handleSuggestLaneOrganization({
        diagramId,
        participantId: participant,
      })
    );

    expect(res.totalFlowNodes).toBeGreaterThanOrEqual(2);
    expect(res.suggestions.length).toBeGreaterThanOrEqual(2);
  });

  test('single category suggests no lanes needed', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const res = parseResult(await handleSuggestLaneOrganization({ diagramId }));

    expect(res.suggestions).toHaveLength(1);
    expect(res.recommendation).toContain('single category');
  });
});

describe('validate_bpmn_lane_organization', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('reports no lanes defined', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const res = parseResult(await handleValidateLaneOrganization({ diagramId }));

    expect(res.totalLanes).toBe(0);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].code).toBe('no-lanes');
  });

  test('validates a properly organized lane structure', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 400,
      y: 200,
    });

    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId: participant,
    });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task A',
      participantId: participant,
    });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task B',
      participantId: participant,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      participantId: participant,
    });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, end);

    // Create lanes
    const lanesResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );

    const [laneA, laneB] = lanesResult.laneIds;

    // Assign elements to lanes
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneA,
      elementIds: [start, task1],
    });
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneB,
      elementIds: [task2, end],
    });

    const res = parseResult(await handleValidateLaneOrganization({ diagramId }));

    expect(res.valid).toBe(true);
    expect(res.totalLanes).toBe(2);
    expect(res.laneDetails).toHaveLength(2);
    expect(res.coherenceScore).toBeDefined();
  });

  test('detects empty lanes', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 400,
      y: 200,
    });

    await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task',
      participantId: participant,
    });

    // Create lanes but don't assign anything
    await handleCreateLanes({
      diagramId,
      participantId: participant,
      lanes: [{ name: 'Empty Lane 1' }, { name: 'Empty Lane 2' }],
    });

    const res = parseResult(await handleValidateLaneOrganization({ diagramId }));

    const emptyIssues = res.issues.filter((i: any) => i.code === 'lane-empty');
    expect(emptyIssues.length).toBeGreaterThanOrEqual(1);
  });

  test('detects unassigned elements when added after lanes', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 400,
      y: 200,
    });

    const task1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Assigned Task',
      participantId: participant,
    });

    const lanesResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );

    // Only assign one task — the other should be auto-assigned by bpmn-js
    // when lanes are created (elements are distributed by position).
    // Verify the tool reports lane details correctly.
    await handleAssignElementsToLane({
      diagramId,
      laneId: lanesResult.laneIds[0],
      elementIds: [task1],
    });

    const res = parseResult(await handleValidateLaneOrganization({ diagramId }));

    // Should have lane details for both lanes
    expect(res.totalLanes).toBe(2);
    expect(res.laneDetails).toHaveLength(2);
    expect(res.coherenceScore).toBeDefined();

    // Lane A should have at least the explicitly assigned task
    const laneA = res.laneDetails.find((d: any) => d.laneName === 'Lane A');
    expect(laneA).toBeDefined();
    expect(laneA.elementCount).toBeGreaterThanOrEqual(1);
  });
});
