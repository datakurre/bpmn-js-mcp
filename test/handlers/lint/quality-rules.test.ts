import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleValidate as handleLintDiagram,
  handleCreateCollaboration,
  handleSetProperties,
  handleMoveElement,
} from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  clearDiagrams,
  connect,
  connectAll,
} from '../../helpers';

describe('subprocess-expansion-issue rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when expanded subprocess is too small', async () => {
    const diagramId = await createDiagram('Subprocess Size Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const sub = await addElement(diagramId, 'bpmn:SubProcess', { name: 'Small Sub' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, sub);
    await connect(diagramId, sub, end);

    // Resize the subprocess to be too small (below 300×180 thresholds)
    await handleMoveElement({
      diagramId,
      elementId: sub,
      width: 200,
      height: 100,
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/subprocess-expansion-issue': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/subprocess-expansion-issue');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('too small');
  });

  test('does not warn when expanded subprocess has adequate size', async () => {
    const diagramId = await createDiagram('Subprocess Size OK');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    // Default expanded subprocess is 350×200 — should be fine
    const sub = await addElement(diagramId, 'bpmn:SubProcess', { name: 'Normal Sub' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, sub);
    await connect(diagramId, sub, end);

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/subprocess-expansion-issue': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/subprocess-expansion-issue');
    expect(issues.length).toBe(0);
  });
});

describe('lane-overcrowding rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when lane has too many elements for its height', async () => {
    const diagramId = await createDiagram('Lane Overcrowding Test');

    // Create a collaboration with a pool
    const collResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Main Pool', width: 1200, height: 400 },
          { name: 'External', collapsed: true },
        ],
      })
    );

    const poolId = collResult.participantIds[0];

    // Create two lanes using addElement
    const laneA = await addElement(diagramId, 'bpmn:Lane', {
      name: 'Manager',
      participantId: poolId,
    });
    await addElement(diagramId, 'bpmn:Lane', {
      name: 'Worker',
      participantId: poolId,
    });

    // Add many elements to the first lane
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review A', laneId: laneA });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review B', laneId: laneA });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review C', laneId: laneA });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review D', laneId: laneA });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review E', laneId: laneA });

    // Resize the first lane to be very small (100px)
    await handleMoveElement({
      diagramId,
      elementId: laneA,
      height: 100,
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/lane-overcrowding': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-overcrowding');
    // With 5 elements in a 100px lane, this should definitely fire
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('elements');
  });

  test('does not warn when lane has adequate height for elements', async () => {
    const diagramId = await createDiagram('Lane Adequate');

    const collResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Pool', width: 1200, height: 600 },
          { name: 'External', collapsed: true },
        ],
      })
    );

    const poolId = collResult.participantIds[0];

    const laneA = await addElement(diagramId, 'bpmn:Lane', {
      name: 'Team A',
      participantId: poolId,
    });
    await addElement(diagramId, 'bpmn:Lane', {
      name: 'Team B',
      participantId: poolId,
    });

    // Just 2 elements in a lane
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1', laneId: laneA });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2', laneId: laneA });

    // Resize lane to be large enough (240+ for 2 elements)
    await handleMoveElement({
      diagramId,
      elementId: laneA,
      height: 300,
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/lane-overcrowding': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-overcrowding');
    expect(issues.length).toBe(0);
  });
});

describe('prefer-lanes-over-pools rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('suggests lanes when multiple expanded executable pools have message flows', async () => {
    const diagramId = await createDiagram('Multi Pool Test');

    // Create collaboration with two expanded pools
    const collResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Customer', width: 600, height: 250 },
          { name: 'Support Agent', width: 600, height: 250 },
        ],
      })
    );

    const [poolIdA, poolIdB] = collResult.participantIds;

    // Add elements to each pool
    const startA = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Request Start',
      participantId: poolIdA,
    });
    const taskA = await addElement(diagramId, 'bpmn:SendTask', {
      name: 'Submit Request',
      participantId: poolIdA,
    });
    const endA = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Request Done',
      participantId: poolIdA,
    });
    await connectAll(diagramId, startA, taskA, endA);

    const startB = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Ticket Start',
      participantId: poolIdB,
    });
    const taskB = await addElement(diagramId, 'bpmn:ReceiveTask', {
      name: 'Handle Request',
      participantId: poolIdB,
    });
    const endB = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Ticket Done',
      participantId: poolIdB,
    });
    await connectAll(diagramId, startB, taskB, endB);

    // Add message flow between pools
    await connect(diagramId, taskA, taskB);

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/prefer-lanes-over-pools': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/prefer-lanes-over-pools');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('lanes');
  });

  test('does not warn when one pool is collapsed', async () => {
    const diagramId = await createDiagram('Collapsed Pool Test');

    await handleCreateCollaboration({
      diagramId,
      participants: [
        { name: 'Our Process', width: 600, height: 250 },
        { name: 'External System', collapsed: true },
      ],
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/prefer-lanes-over-pools': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/prefer-lanes-over-pools');
    expect(issues.length).toBe(0);
  });
});

describe('role-mismatch-with-lane rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when user task assignee does not match lane name', async () => {
    const diagramId = await createDiagram('Role Mismatch Test');

    // Create collaboration with a pool
    const collResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Organization', width: 800, height: 400 },
          { name: 'External', collapsed: true },
        ],
      })
    );

    const poolId = collResult.participantIds[0];

    // Create lanes
    const managerLane = await addElement(diagramId, 'bpmn:Lane', {
      name: 'Manager',
      participantId: poolId,
    });
    await addElement(diagramId, 'bpmn:Lane', {
      name: 'Developer',
      participantId: poolId,
    });

    // Add a user task and assign to Manager lane
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review Code',
      laneId: managerLane,
    });

    // Set assignee to "finance" which doesn't match "Manager"
    await handleSetProperties({
      diagramId,
      elementId: task,
      properties: { 'camunda:assignee': 'finance_team' },
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/role-mismatch-with-lane': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/role-mismatch-with-lane');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('finance_team');
    expect(issues[0].message).toContain('Manager');
  });

  test('does not warn when assignee matches lane name', async () => {
    const diagramId = await createDiagram('Role Match Test');

    const collResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Organization', width: 800, height: 400 },
          { name: 'External', collapsed: true },
        ],
      })
    );

    const poolId = collResult.participantIds[0];

    const managerLane = await addElement(diagramId, 'bpmn:Lane', {
      name: 'Manager',
      participantId: poolId,
    });
    await addElement(diagramId, 'bpmn:Lane', {
      name: 'Developer',
      participantId: poolId,
    });

    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Approve Request',
      laneId: managerLane,
    });

    // Set assignee that matches the lane name (fuzzy match)
    await handleSetProperties({
      diagramId,
      elementId: task,
      properties: { 'camunda:assignee': 'manager' },
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/role-mismatch-with-lane': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/role-mismatch-with-lane');
    expect(issues.length).toBe(0);
  });
});
