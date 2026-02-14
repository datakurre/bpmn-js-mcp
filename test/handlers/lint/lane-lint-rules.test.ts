import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleValidate as handleLintDiagram,
  handleCreateCollaboration,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connectAll } from '../../helpers';

/**
 * Tests for lane-related bpmnlint rules:
 * - empty-participant-with-lanes
 * - lane-zigzag-flow
 */

describe('lane lint rules', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('empty-participant-with-lanes', () => {
    test('errors when an empty expanded pool exists alongside a pool with lanes', async () => {
      const diagramId = await createDiagram('Empty Pool');

      // Create collaboration with two pools
      const collResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Main Process', width: 800, height: 400 },
            { name: 'Empty Pool', width: 800, height: 250 },
          ],
        })
      );

      const mainPoolId = collResult.participantIds[0];

      // Add lanes to the first pool
      await addElement(diagramId, 'bpmn:Lane', {
        name: 'Lane A',
        participantId: mainPoolId,
      });
      await addElement(diagramId, 'bpmn:Lane', {
        name: 'Lane B',
        participantId: mainPoolId,
      });

      // Add some elements to the main pool
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        participantId: mainPoolId,
      });
      const task = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Do Work',
        participantId: mainPoolId,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'End',
        participantId: mainPoolId,
      });
      await connectAll(diagramId, start, task, end);

      // The second pool is expanded but empty — should trigger the rule
      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/empty-participant-with-lanes': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/empty-participant-with-lanes'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('Empty Pool');
      expect(issues[0].message).toContain('empty');
    });

    test('does not flag collapsed pools', async () => {
      const diagramId = await createDiagram('Collapsed Pool');

      // Create collaboration with one expanded + one collapsed pool
      const collResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Main Process', width: 800, height: 400 },
            { name: 'External System', collapsed: true },
          ],
        })
      );

      const mainPoolId = collResult.participantIds[0];

      // Add lanes to the main pool
      await addElement(diagramId, 'bpmn:Lane', {
        name: 'Lane A',
        participantId: mainPoolId,
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/empty-participant-with-lanes': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/empty-participant-with-lanes'
      );
      expect(issues).toHaveLength(0);
    });

    test('does not flag when no sibling has lanes', async () => {
      const diagramId = await createDiagram('No Lanes');

      // Create collaboration with two pools, neither has lanes
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Pool A', width: 800, height: 250 },
          { name: 'Pool B', width: 800, height: 250 },
        ],
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/empty-participant-with-lanes': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/empty-participant-with-lanes'
      );
      expect(issues).toHaveLength(0);
    });

    test('does not flag when empty pool has no sibling with lanes', async () => {
      const diagramId = await createDiagram('Both Empty');

      // Create collaboration with two expanded pools, both empty, no lanes
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Pool A', width: 800, height: 250 },
          { name: 'Pool B', width: 800, height: 250 },
        ],
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/empty-participant-with-lanes': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/empty-participant-with-lanes'
      );
      expect(issues).toHaveLength(0);
    });
  });

  describe('lane-zigzag-flow', () => {
    test('warns when flow zigzags across lanes (A → B → A)', async () => {
      const diagramId = await createDiagram('Zigzag');

      // Create a collaboration with one expanded pool + one collapsed
      const collResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Organization', width: 1200, height: 600 },
            { name: 'External', collapsed: true },
          ],
        })
      );

      const poolId = collResult.participantIds[0];

      // Add two lanes
      const laneA = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team A',
        participantId: poolId,
      });
      const laneB = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team B',
        participantId: poolId,
      });

      // Add elements: task1 in A, task2 in B, task3 in A (zigzag)
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        laneId: laneA,
      });
      const task1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Review',
        laneId: laneA,
      });
      const task2 = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Notify',
        laneId: laneB,
      });
      const task3 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Approve',
        laneId: laneA,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'End',
        laneId: laneA,
      });

      await connectAll(diagramId, start, task1, task2, task3, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/lane-zigzag-flow': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-zigzag-flow');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('Zigzag');
      expect(issues[0].message).toContain('Notify');
    });

    test('does not warn when flow stays within lanes', async () => {
      const diagramId = await createDiagram('No Zigzag');

      const collResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Organization', width: 1200, height: 600 },
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

      // All elements in the same lane — no zigzag
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        laneId: laneA,
      });
      const task1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Review',
        laneId: laneA,
      });
      const task2 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Approve',
        laneId: laneA,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'End',
        laneId: laneA,
      });

      await connectAll(diagramId, start, task1, task2, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/lane-zigzag-flow': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-zigzag-flow');
      expect(issues).toHaveLength(0);
    });

    test('does not warn when crossing lanes once (A → B)', async () => {
      const diagramId = await createDiagram('Single Cross');

      const collResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Organization', width: 1200, height: 600 },
            { name: 'External', collapsed: true },
          ],
        })
      );

      const poolId = collResult.participantIds[0];

      const laneA = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team A',
        participantId: poolId,
      });
      const laneB = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team B',
        participantId: poolId,
      });

      // A → A → B → B — single transition, no zigzag
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        laneId: laneA,
      });
      const task1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Review',
        laneId: laneA,
      });
      const task2 = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process',
        laneId: laneB,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'End',
        laneId: laneB,
      });

      await connectAll(diagramId, start, task1, task2, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/lane-zigzag-flow': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-zigzag-flow');
      expect(issues).toHaveLength(0);
    });

    test('does not warn for processes without lanes', async () => {
      const diagramId = await createDiagram('No Lanes');

      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await connectAll(diagramId, start, task, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/lane-zigzag-flow': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-zigzag-flow');
      expect(issues).toHaveLength(0);
    });
  });
});
