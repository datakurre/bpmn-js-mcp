/**
 * TDD tests for the implicit-merge lint rule severity upgrade.
 *
 * These tests verify that:
 * 1. `bpmn-mcp/implicit-merge` fires as `error` severity (not `warn`).
 * 2. The fix tool call uses `flowId` (not a bare elementId).
 * 3. The lint suggestion text mentions `flowId`.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleValidate } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { FIX_SUGGESTIONS } from '../../../src/lint-suggestions';
import { lintDiagramFlat } from '../../../src/linter';
import { getDiagram } from '../../../src/diagram-manager';

/** Build a minimal diagram where a task has 2 incoming flows (implicit merge). */
async function buildImplicitMergeDiagram() {
  const diagramId = await createDiagram('Implicit Merge Test');
  const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
  const taskId = await addElement(diagramId, 'bpmn:Task', {
    name: 'Charge Payment',
    x: 300,
    y: 100,
  });
  const retryId = await addElement(diagramId, 'bpmn:Task', {
    name: 'Retry Payment',
    x: 300,
    y: 250,
  });
  const endId = await addElement(diagramId, 'bpmn:EndEvent', { x: 500, y: 100 });

  // Two flows into taskId → implicit merge
  await connect(diagramId, startId, taskId);
  await connect(diagramId, retryId, taskId);
  await connect(diagramId, taskId, endId);

  return { diagramId, taskId };
}

describe('implicit-merge lint rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('fires on a task with 2 incoming flows', async () => {
    const { diagramId } = await buildImplicitMergeDiagram();
    const res = parseResult(await handleValidate({ diagramId }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-merge');
    expect(issues.length).toBeGreaterThan(0);
  });

  test('fires as error severity (not warning)', async () => {
    const { diagramId } = await buildImplicitMergeDiagram();
    const diagram = getDiagram(diagramId);
    const flat = await lintDiagramFlat(diagram!);
    const issues = flat.filter((i) => i.rule === 'bpmn-mcp/implicit-merge');
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.severity).toBe('error');
    }
  });

  test('validate response includes error severity for implicit-merge', async () => {
    const { diagramId } = await buildImplicitMergeDiagram();
    const res = parseResult(await handleValidate({ diagramId }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-merge');
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.severity).toBe('error');
    }
  });

  test('validate fixToolCall uses flowId arg', async () => {
    const { diagramId } = await buildImplicitMergeDiagram();
    const res = parseResult(await handleValidate({ diagramId }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-merge');
    expect(issues.length).toBeGreaterThan(0);
    // The fix tool call should reference flowId (not bare elementId)
    for (const issue of issues) {
      if (issue.fixToolCall) {
        expect(issue.fixToolCall.args).toHaveProperty('flowId');
      }
    }
  });

  test('lint-suggestions text mentions flowId', () => {
    const suggestion = FIX_SUGGESTIONS['bpmn-mcp/implicit-merge'];
    expect(suggestion).toBeDefined();
    expect(suggestion).toContain('flowId');
  });

  test('does not fire when gateway absorbs two flows', async () => {
    const diagramId = await createDiagram('Explicit Merge');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const retryId = await addElement(diagramId, 'bpmn:Task', { name: 'Retry', x: 100, y: 250 });
    const gwId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Merge?',
      x: 280,
      y: 100,
    });
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Charge Payment',
      x: 430,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { x: 580, y: 100 });

    await connect(diagramId, startId, gwId);
    await connect(diagramId, retryId, gwId);
    await connect(diagramId, gwId, taskId);
    await connect(diagramId, taskId, endId);

    const diagram = getDiagram(diagramId);
    const flat = await lintDiagramFlat(diagram!);
    const issues = flat.filter((i) => i.rule === 'bpmn-mcp/implicit-merge');
    expect(issues).toHaveLength(0);
  });
});
