import { describe, it, expect, beforeEach } from 'vitest';
import { handleConnect, handleLintDiagram } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('bpmnlint custom rules', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('naming-convention', () => {
    it('warns when activity does not start with a verb', async () => {
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

    it('does not warn when activity starts with a verb', async () => {
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

    it('warns when gateway does not end with ?', async () => {
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
    it('warns when activity has multiple conditional outgoing flows', async () => {
      const diagramId = await createDiagram('Implicit Split');
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Accept' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });

      await handleConnect({
        diagramId,
        sourceElementId: task,
        targetElementId: taskA,
        conditionExpression: '${approved}',
      });
      await handleConnect({
        diagramId,
        sourceElementId: task,
        targetElementId: taskB,
        conditionExpression: '${!approved}',
      });

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
    it('warns when split gateway has no matching join', async () => {
      const diagramId = await createDiagram('Unpaired Gateway');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: split });
      await handleConnect({ diagramId, sourceElementId: split, targetElementId: taskA });
      await handleConnect({ diagramId, sourceElementId: split, targetElementId: taskB });
      await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: end });
      await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: end });

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

    it('does not warn when split has matching join', async () => {
      const diagramId = await createDiagram('Paired Gateway');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await handleConnect({ diagramId, sourceElementId: start, targetElementId: split });
      await handleConnect({ diagramId, sourceElementId: split, targetElementId: taskA });
      await handleConnect({ diagramId, sourceElementId: split, targetElementId: taskB });
      await handleConnect({ diagramId, sourceElementId: taskA, targetElementId: join });
      await handleConnect({ diagramId, sourceElementId: taskB, targetElementId: join });
      await handleConnect({ diagramId, sourceElementId: join, targetElementId: end });

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
