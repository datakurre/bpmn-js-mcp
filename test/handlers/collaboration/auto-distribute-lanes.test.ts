import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateLanes, handleSetProperties, handleConnect } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams, getRegistry } from '../../helpers';

describe('create_bpmn_lanes autoDistribute', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('auto-distributes elements by role (camunda:assignee)', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'HR Pool',
      x: 400,
      y: 250,
    });

    // Add tasks with different assignees
    const task1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Submit Request',
      participantId: participant,
    });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Approve Request',
      participantId: participant,
    });
    const task3 = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Payment',
      participantId: participant,
    });

    // Set assignees
    await handleSetProperties({
      diagramId,
      elementId: task1,
      properties: { 'camunda:assignee': 'Employee' },
    });
    await handleSetProperties({
      diagramId,
      elementId: task2,
      properties: { 'camunda:assignee': 'Manager' },
    });

    // Create lanes with autoDistribute
    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Employee' }, { name: 'Manager' }, { name: 'System' }],
        autoDistribute: true,
      })
    );

    expect(res.success).toBe(true);
    expect(res.laneCount).toBe(3);
    expect(res.autoDistribute).toBeDefined();
    expect(res.autoDistribute.assignedCount).toBe(3);

    // Employee task should be in Employee lane
    expect(res.autoDistribute.assignments[res.laneIds[0]]).toContain(task1);
    // Manager task should be in Manager lane
    expect(res.autoDistribute.assignments[res.laneIds[1]]).toContain(task2);
    // Service task should be in System lane (type-based fallback)
    expect(res.autoDistribute.assignments[res.laneIds[2]]).toContain(task3);
  });

  test('auto-distributes flow-control elements to most-connected lane', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 400,
      y: 250,
    });

    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId: participant,
    });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
      participantId: participant,
    });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Auto Process',
      participantId: participant,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      participantId: participant,
    });

    // Set assignees
    await handleSetProperties({
      diagramId,
      elementId: task1,
      properties: { 'camunda:assignee': 'Reviewer' },
    });

    // Connect flow
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task1 });
    await handleConnect({ diagramId, sourceElementId: task1, targetElementId: task2 });
    await handleConnect({ diagramId, sourceElementId: task2, targetElementId: end });

    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Reviewer' }, { name: 'Automation' }],
        autoDistribute: true,
      })
    );

    expect(res.success).toBe(true);
    expect(res.autoDistribute.assignedCount).toBeGreaterThanOrEqual(4);

    // Start event should be assigned to the Reviewer lane (connected to Reviewer task)
    const reviewerLane = res.laneIds[0];
    expect(res.autoDistribute.assignments[reviewerLane]).toContain(start);
    expect(res.autoDistribute.assignments[reviewerLane]).toContain(task1);
  });

  test('handles empty participant gracefully', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Empty Pool',
      x: 400,
      y: 250,
    });

    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
        autoDistribute: true,
      })
    );

    expect(res.success).toBe(true);
    expect(res.laneCount).toBe(2);
    expect(res.autoDistribute.assignedCount).toBe(0);
  });

  test('works without autoDistribute (default behavior unchanged)', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 400,
      y: 250,
    });

    await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task',
      participantId: participant,
    });

    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.laneCount).toBe(2);
    // autoDistribute should not be present when not requested
    expect(res.autoDistribute).toBeUndefined();
  });

  test('matches lane names case-insensitively', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 400,
      y: 250,
    });

    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'My Task',
      participantId: participant,
    });

    await handleSetProperties({
      diagramId,
      elementId: task,
      properties: { 'camunda:assignee': 'ADMIN' },
    });

    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Admin' }, { name: 'User' }],
        autoDistribute: true,
      })
    );

    expect(res.success).toBe(true);
    // "ADMIN" assignee should match "Admin" lane
    expect(res.autoDistribute.assignments[res.laneIds[0]]).toContain(task);
  });

  test('repositions elements vertically within their assigned lanes', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 400,
      y: 250,
    });

    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'My Task',
      participantId: participant,
    });

    await handleSetProperties({
      diagramId,
      elementId: task,
      properties: { 'camunda:assignee': 'Role B' },
    });

    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Role A' }, { name: 'Role B' }],
        autoDistribute: true,
      })
    );

    expect(res.success).toBe(true);
    expect(res.autoDistribute.assignedCount).toBe(1);

    // Task should be in Role B lane (second lane)
    const roleBLane = res.laneIds[1];
    expect(res.autoDistribute.assignments[roleBLane]).toContain(task);

    // Verify the element was repositioned within the second lane
    const registry = getRegistry(diagramId);
    const taskShape = registry.get(task);
    const laneShape = registry.get(roleBLane);

    // Element center should be within lane bounds
    const taskCenterY = taskShape.y + taskShape.height / 2;
    expect(taskCenterY).toBeGreaterThanOrEqual(laneShape.y);
    expect(taskCenterY).toBeLessThanOrEqual(laneShape.y + laneShape.height);
  });

  test('uses candidateGroups for matching when assignee not set', async () => {
    const diagramId = await createDiagram();
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 400,
      y: 250,
    });

    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Group Task',
      participantId: participant,
    });

    await handleSetProperties({
      diagramId,
      elementId: task,
      properties: { 'camunda:candidateGroups': 'Finance, HR' },
    });

    const res = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Finance' }, { name: 'Operations' }],
        autoDistribute: true,
      })
    );

    expect(res.success).toBe(true);
    // Should match first candidateGroup "Finance" to "Finance" lane
    expect(res.autoDistribute.assignments[res.laneIds[0]]).toContain(task);
  });
});
