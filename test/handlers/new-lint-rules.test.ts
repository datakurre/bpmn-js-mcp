import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleConnect,
  handleLintDiagram,
  handleSetProperties,
  handleSetEventDefinition,
} from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

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

      await handleConnect({
        diagramId,
        elementIds: [start, task, end],
      });

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

      await handleConnect({ diagramId, elementIds: [start, task, end] });

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
      await handleConnect({
        diagramId,
        elementIds: [boundaryEvent, compThrow, cancelEnd],
      });

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

      await handleConnect({ diagramId, elementIds: [start, task, end] });

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
      await handleConnect({
        diagramId,
        sourceElementId: boundaryEvent,
        targetElementId: timeoutEnd,
      });

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

      await handleConnect({ diagramId, elementIds: [start, task, gw] });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: end,
        isDefault: true,
      });
      // Loop back without any limiting mechanism
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: task,
        conditionExpression: '${!valid}',
        label: 'No',
      });

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

      await handleConnect({ diagramId, elementIds: [start, task, gw] });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: end,
        isDefault: true,
      });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: task,
        conditionExpression: '${!valid}',
        label: 'No',
      });

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
      await handleConnect({
        diagramId,
        sourceElementId: timerBound,
        targetElementId: timeoutEnd,
      });

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

      await handleConnect({ diagramId, elementIds: [start, task, counter, gw] });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: end,
        isDefault: true,
      });
      // Loop back through the counter script
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: task,
        conditionExpression: '${!valid}',
        label: 'No',
      });

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

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskA,
        conditionExpression: '${approved}',
      });
      // Second flow has no condition and is not set as default
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskB,
      });
      await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: end });
      await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: end });

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

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskA,
        conditionExpression: '${approved}',
      });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskB,
        conditionExpression: '${!approved}',
      });
      await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: end });
      await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: end });

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

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskA,
        conditionExpression: '${approved}',
      });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskB,
        isDefault: true,
      });
      await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: end });
      await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: end });

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

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskA,
        conditionExpression: '${route == "A"}',
      });
      // Two flows without conditions
      await handleConnect({ diagramId, sourceElementId: gw, targetElementId: taskB });
      await handleConnect({ diagramId, sourceElementId: gw, targetElementId: taskC });

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

      await handleConnect({ diagramId, elementIds: [start, task, end] });

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

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: xgw });
      await handleConnect({ diagramId, sourceElementId: xgw, targetElementId: taskA });
      await handleConnect({ diagramId, sourceElementId: xgw, targetElementId: taskB });
      await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: pjoin });
      await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: pjoin });
      await handleConnect({ diagramId, sourceElementId: pjoin, targetElementId: end });

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

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: psplit });
      await handleConnect({ diagramId, sourceElementId: psplit, targetElementId: taskA });
      await handleConnect({ diagramId, sourceElementId: psplit, targetElementId: taskB });
      await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: pjoin });
      await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: pjoin });
      await handleConnect({ diagramId, sourceElementId: pjoin, targetElementId: end });

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

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: xsplit });
      await handleConnect({ diagramId, sourceElementId: xsplit, targetElementId: taskA });
      await handleConnect({ diagramId, sourceElementId: xsplit, targetElementId: taskB });
      await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: xjoin });
      await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: xjoin });
      await handleConnect({ diagramId, sourceElementId: xjoin, targetElementId: end });

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
});
