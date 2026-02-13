import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLintDiagram,
  handleSetProperties,
  handleSetEventDefinition,
} from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  clearDiagrams,
  connect,
  connectAll,
} from '../../helpers';

describe('bpmnlint new rules', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('compensation-missing-association', () => {
    test('errors when compensation boundary event has no association to handler', async () => {
      const diagramId = await createDiagram('Compensation Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Payment' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await connectAll(diagramId, start, task, end);

      // Add compensation boundary event (without association)
      const boundaryEvent = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Compensation',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: boundaryEvent,
        eventDefinitionType: 'bpmn:CompensateEventDefinition',
      });

      // Add handler marked isForCompensation but not associated
      const handler = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Refund' });
      await handleSetProperties({
        diagramId,
        elementId: handler,
        properties: { isForCompensation: true },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/compensation-missing-association': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/compensation-missing-association'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('association');
    });
  });

  describe('boundary-event-scope', () => {
    test('warns when message boundary event leads to cancellation path', async () => {
      const diagramId = await createDiagram('Scope Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Details' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connectAll(diagramId, start, task, end);

      // Add message boundary event
      const boundaryEvent = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Cancel',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: boundaryEvent,
        eventDefinitionType: 'bpmn:MessageEventDefinition',
        messageRef: { id: 'Msg_Cancel', name: 'Cancel Message' },
      });

      // Add compensation throw after boundary (terminal path)
      const compThrow = await addElement(diagramId, 'bpmn:IntermediateThrowEvent', {
        name: 'Compensate',
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: compThrow,
        eventDefinitionType: 'bpmn:CompensateEventDefinition',
      });

      const cancelEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Registration Cancelled',
      });
      await connectAll(diagramId, boundaryEvent, compThrow, cancelEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/boundary-event-scope': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/boundary-event-scope');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('event subprocess');
    });

    test('does not warn for timer boundary events', async () => {
      const diagramId = await createDiagram('Timer Boundary');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Wait Task' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connectAll(diagramId, start, task, end);

      const boundaryEvent = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timeout',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: boundaryEvent,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT1H' },
      });

      const timeoutEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timed Out' });
      await connect(diagramId, boundaryEvent, timeoutEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/boundary-event-scope': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/boundary-event-scope');
      expect(issues.length).toBe(0);
    });
  });

  describe('loop-without-limit', () => {
    test('warns when a loop has no limiting mechanism', async () => {
      const diagramId = await createDiagram('Unlimited Loop');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connectAll(diagramId, start, task, gw);
      await connect(diagramId, gw, end, { isDefault: true });
      // Loop back without any limiting mechanism
      await connect(diagramId, gw, task, { conditionExpression: '${!valid}', label: 'No' });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/loop-without-limit': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/loop-without-limit');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('limiting mechanism');
    });

    test('does not warn when loop has a timer boundary event', async () => {
      const diagramId = await createDiagram('Limited Loop');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connectAll(diagramId, start, task, gw);
      await connect(diagramId, gw, end, { isDefault: true });
      await connect(diagramId, gw, task, { conditionExpression: '${!valid}', label: 'No' });

      // Add timer boundary event (acts as loop limiter)
      const timerBound = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timeout',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: timerBound,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT30M' },
      });

      const timeoutEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timed Out' });
      await connect(diagramId, timerBound, timeoutEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/loop-without-limit': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/loop-without-limit');
      expect(issues.length).toBe(0);
    });

    test('does not warn when loop has a script task (counter)', async () => {
      const diagramId = await createDiagram('Counter Loop');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });
      const counter = await addElement(diagramId, 'bpmn:ScriptTask', {
        name: 'Increment Counter',
      });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connectAll(diagramId, start, task, counter, gw);
      await connect(diagramId, gw, end, { isDefault: true });
      // Loop back through the counter script
      await connect(diagramId, gw, task, { conditionExpression: '${!valid}', label: 'No' });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/loop-without-limit': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/loop-without-limit');
      expect(issues.length).toBe(0);
    });
  });

  describe('exclusive-gateway-conditions', () => {
    test('errors when gateway has mixed conditional/unconditional flows with no default', async () => {
      const diagramId = await createDiagram('Mixed Conditions');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Accept' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, gw);
      await connect(diagramId, gw, taskA, { conditionExpression: '${approved}' });
      // Second flow has no condition and is not set as default
      await connect(diagramId, gw, taskB);
      await connect(diagramId, taskA, end);
      await connect(diagramId, taskB, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/exclusive-gateway-conditions': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/exclusive-gateway-conditions'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('default');
    });

    test('does not error when all flows have conditions', async () => {
      const diagramId = await createDiagram('All Conditions');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Accept' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, gw);
      await connect(diagramId, gw, taskA, { conditionExpression: '${approved}' });
      await connect(diagramId, gw, taskB, { conditionExpression: '${!approved}' });
      await connect(diagramId, taskA, end);
      await connect(diagramId, taskB, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/exclusive-gateway-conditions': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/exclusive-gateway-conditions'
      );
      expect(issues.length).toBe(0);
    });

    test('does not error when unconditional flow is set as default', async () => {
      const diagramId = await createDiagram('With Default');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Accept' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, gw);
      await connect(diagramId, gw, taskA, { conditionExpression: '${approved}' });
      await connect(diagramId, gw, taskB, { isDefault: true });
      await connect(diagramId, taskA, end);
      await connect(diagramId, taskB, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/exclusive-gateway-conditions': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/exclusive-gateway-conditions'
      );
      expect(issues.length).toBe(0);
    });

    test('errors when multiple flows lack conditions', async () => {
      const diagramId = await createDiagram('Multiple Uncond');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Route?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Path A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Path B' });
      const taskC = await addElement(diagramId, 'bpmn:Task', { name: 'Path C' });

      await connect(diagramId, start, gw);
      await connect(diagramId, gw, taskA, { conditionExpression: '${route == "A"}' });
      // Two flows without conditions
      await connect(diagramId, gw, taskB);
      await connect(diagramId, gw, taskC);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/exclusive-gateway-conditions': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/exclusive-gateway-conditions'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('without conditions');
    });
  });

  describe('compensation-missing-association (orphaned handler)', () => {
    test('errors when compensation handler has no association from boundary event', async () => {
      const diagramId = await createDiagram('Orphaned Handler');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Charge Card' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await connectAll(diagramId, start, task, end);

      // Create a handler with isForCompensation=true but no boundary event at all
      const handler = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Refund Card' });
      await handleSetProperties({
        diagramId,
        elementId: handler,
        properties: { isForCompensation: true },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/compensation-missing-association': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/compensation-missing-association'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((i: any) => i.message.includes('not connected'))).toBe(true);
    });
  });

  describe('parallel-gateway-merge-exclusive', () => {
    test('warns when parallel gateway merges exclusive gateway branches', async () => {
      const diagramId = await createDiagram('Parallel Merges Exclusive');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const xgw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Accept' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });
      const pjoin = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Merge' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, xgw);
      await connect(diagramId, xgw, taskA);
      await connect(diagramId, xgw, taskB);
      await connect(diagramId, taskA, pjoin);
      await connect(diagramId, taskB, pjoin);
      await connect(diagramId, pjoin, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/parallel-gateway-merge-exclusive': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/parallel-gateway-merge-exclusive'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('deadlock');
    });

    test('does not warn when parallel gateway merges parallel gateway branches', async () => {
      const diagramId = await createDiagram('Parallel Merges Parallel');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const psplit = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const pjoin = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, psplit);
      await connect(diagramId, psplit, taskA);
      await connect(diagramId, psplit, taskB);
      await connect(diagramId, taskA, pjoin);
      await connect(diagramId, taskB, pjoin);
      await connect(diagramId, pjoin, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/parallel-gateway-merge-exclusive': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/parallel-gateway-merge-exclusive'
      );
      expect(issues.length).toBe(0);
    });

    test('does not warn for exclusive merge after exclusive split', async () => {
      const diagramId = await createDiagram('Exclusive Merges Exclusive');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const xsplit = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Route?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Path A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Path B' });
      const xjoin = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, xsplit);
      await connect(diagramId, xsplit, taskA);
      await connect(diagramId, xsplit, taskB);
      await connect(diagramId, taskA, xjoin);
      await connect(diagramId, taskB, xjoin);
      await connect(diagramId, xjoin, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/parallel-gateway-merge-exclusive': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/parallel-gateway-merge-exclusive'
      );
      expect(issues.length).toBe(0);
    });
  });

  describe('user-task-missing-assignee', () => {
    test('warns when user task has no assignee or candidates', async () => {
      const diagramId = await createDiagram('No Assignee');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, task);
      await connect(diagramId, task, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/user-task-missing-assignee': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/user-task-missing-assignee'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('assignee');
    });

    test('does not warn when user task has camunda:assignee', async () => {
      const diagramId = await createDiagram('Has Assignee');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, task);
      await connect(diagramId, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:assignee': 'john' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/user-task-missing-assignee': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/user-task-missing-assignee'
      );
      expect(issues.length).toBe(0);
    });

    test('does not warn when user task has camunda:candidateGroups', async () => {
      const diagramId = await createDiagram('Has Candidates');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, task);
      await connect(diagramId, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:candidateGroups': 'managers' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/user-task-missing-assignee': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/user-task-missing-assignee'
      );
      expect(issues.length).toBe(0);
    });

    test('does not warn for non-user tasks', async () => {
      const diagramId = await createDiagram('Service Task');
      await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Payment' });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/user-task-missing-assignee': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/user-task-missing-assignee'
      );
      expect(issues.length).toBe(0);
    });
  });

  describe('implicit-merge', () => {
    test('errors when activity has multiple incoming flows without merge gateway', async () => {
      const diagramId = await createDiagram('Implicit Merge');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const target = await addElement(diagramId, 'bpmn:Task', { name: 'Process' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, taskA);
      await connect(diagramId, start, taskB);
      await connect(diagramId, taskA, target);
      await connect(diagramId, taskB, target);
      await connect(diagramId, target, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/implicit-merge': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-merge');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('merge gateway');
    });

    test('errors when end event has multiple incoming flows', async () => {
      const diagramId = await createDiagram('Implicit Merge End');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, taskA);
      await connect(diagramId, start, taskB);
      await connect(diagramId, taskA, end);
      await connect(diagramId, taskB, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/implicit-merge': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-merge');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('End event');
    });

    test('does not error when using explicit merge gateway', async () => {
      const diagramId = await createDiagram('Explicit Merge');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, split);
      await connect(diagramId, split, taskA);
      await connect(diagramId, split, taskB);
      await connect(diagramId, taskA, join);
      await connect(diagramId, taskB, join);
      await connect(diagramId, join, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/implicit-merge': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-merge');
      expect(issues.length).toBe(0);
    });

    test('does not error for single incoming flow', async () => {
      const diagramId = await createDiagram('Single Incoming');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:Task', { name: 'Process' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, task);
      await connect(diagramId, task, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/implicit-merge': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-merge');
      expect(issues.length).toBe(0);
    });
  });
});
