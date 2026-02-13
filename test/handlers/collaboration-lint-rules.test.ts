import { describe, test, expect, beforeEach } from 'vitest';
import { handleLintDiagram, handleCreateCollaboration, handleConnect } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connectAll } from '../helpers';

/**
 * Tests for the 4 new bpmnlint rules:
 * - no-duplicate-named-flow-nodes
 * - collaboration-participant-missing-processref
 * - collaboration-multiple-participants-no-messageflows
 * - elements-outside-participant-bounds
 */

describe('collaboration and duplication lint rules', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('no-duplicate-named-flow-nodes', () => {
    test('warns when same (type, name) appears twice', async () => {
      const diagramId = await createDiagram('Duplicate Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
      const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await connectAll(diagramId, start, task1, task2, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/no-duplicate-named-flow-nodes': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/no-duplicate-named-flow-nodes'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('Duplicate');
      expect(issues[0].message).toContain('Review Order');
    });

    test('does not warn when same name but different types', async () => {
      const diagramId = await createDiagram('Different Types');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
      const service = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await connectAll(diagramId, start, task, service, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/no-duplicate-named-flow-nodes': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/no-duplicate-named-flow-nodes'
      );
      expect(issues).toHaveLength(0);
    });

    test('does not warn for unnamed elements', async () => {
      const diagramId = await createDiagram('Unnamed Test');
      await addElement(diagramId, 'bpmn:UserTask');
      await addElement(diagramId, 'bpmn:UserTask');

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/no-duplicate-named-flow-nodes': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/no-duplicate-named-flow-nodes'
      );
      expect(issues).toHaveLength(0);
    });
  });

  describe('collaboration-multiple-participants-no-messageflows', () => {
    test('warns when collaboration has 2+ participants but no message flows', async () => {
      const diagramId = await createDiagram('No MessageFlow');

      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Customer' }, { name: 'Service Desk', collapsed: true }],
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/collaboration-multiple-participants-no-messageflows': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/collaboration-multiple-participants-no-messageflows'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('no message flows');
    });

    test('does not warn when message flows exist', async () => {
      const diagramId = await createDiagram('Has MessageFlow');

      const collResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [{ name: 'Customer' }, { name: 'Service Desk', collapsed: true }],
        })
      );

      // Add an element in the expanded pool and a message flow
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Send Request',
        participantId: collResult.participantIds[0],
      });

      // Connect task to collapsed pool via message flow
      await handleConnect({
        diagramId,
        sourceElementId: task,
        targetElementId: collResult.participantIds[1],
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/collaboration-multiple-participants-no-messageflows': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/collaboration-multiple-participants-no-messageflows'
      );
      expect(issues).toHaveLength(0);
    });
  });
});
