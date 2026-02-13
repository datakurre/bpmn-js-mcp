import { describe, test, expect, beforeEach } from 'vitest';
import { handleLintDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';

describe('bpmnlint custom rules', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('naming-convention', () => {
    test('warns when activity does not start with a verb', async () => {
      const diagramId = await createDiagram('Naming Test');
      await addElement(diagramId, 'bpmn:UserTask', { name: 'Customer Notification' });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/naming-convention': 'warn' },
          },
        })
      );

      const namingIssues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/naming-convention');
      expect(namingIssues.length).toBeGreaterThan(0);
      expect(namingIssues[0].message).toContain('verb-object');
    });

    test('does not warn when activity starts with a verb', async () => {
      const diagramId = await createDiagram('Good Naming');
      await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Order' });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/naming-convention': 'warn' },
          },
        })
      );

      const namingIssues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/naming-convention');
      expect(namingIssues.length).toBe(0);
    });

    test('warns when gateway does not end with ?', async () => {
      const diagramId = await createDiagram('Gateway Naming');
      await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check order' });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/naming-convention': 'warn' },
          },
        })
      );

      const namingIssues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/naming-convention');
      expect(namingIssues.length).toBeGreaterThan(0);
      expect(namingIssues[0].message).toContain('?');
    });
  });

  describe('implicit-split', () => {
    test('warns when activity has multiple conditional outgoing flows', async () => {
      const diagramId = await createDiagram('Implicit Split');
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Accept' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });

      await connect(diagramId, task, taskA, { conditionExpression: '${approved}' });
      await connect(diagramId, task, taskB, { conditionExpression: '${!approved}' });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/implicit-split': 'warn' },
          },
        })
      );

      const splitIssues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-split');
      expect(splitIssues.length).toBeGreaterThan(0);
      expect(splitIssues[0].message).toContain('explicit gateway');
    });
  });

  describe('gateway-pair-mismatch', () => {
    test('warns when split gateway has no matching join', async () => {
      const diagramId = await createDiagram('Unpaired Gateway');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await connect(diagramId, start, split);
      await connect(diagramId, split, taskA);
      await connect(diagramId, split, taskB);
      await connect(diagramId, taskA, end);
      await connect(diagramId, taskB, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/gateway-pair-mismatch': 'warn' },
          },
        })
      );

      const pairIssues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/gateway-pair-mismatch');
      expect(pairIssues.length).toBeGreaterThan(0);
    });

    test('does not warn when split has matching join', async () => {
      const diagramId = await createDiagram('Paired Gateway');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

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
            rules: { 'bpmn-mcp/gateway-pair-mismatch': 'warn' },
          },
        })
      );

      const pairIssues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/gateway-pair-mismatch');
      expect(pairIssues.length).toBe(0);
    });
  });
});
