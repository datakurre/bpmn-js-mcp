import { describe, test, expect, beforeEach } from 'vitest';
import { handleValidate as handleLintDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';

describe('bpmnlint lanes-expected-but-missing', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('reports info when process has ≥3 user tasks and no lanes', async () => {
    const diagramId = await createDiagram('No Lanes');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Execute' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, t3);
    await connect(diagramId, t3, end);

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/lanes-expected-but-missing': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lanes-expected-but-missing');
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('3 user/manual tasks');
    expect(issues[0].message).toContain('no lanes');
  });

  test('does not report when process has < 3 user tasks', async () => {
    const diagramId = await createDiagram('Few Tasks');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/lanes-expected-but-missing': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lanes-expected-but-missing');
    expect(issues.length).toBe(0);
  });

  test('does not report when process has only service tasks', async () => {
    const diagramId = await createDiagram('Service Only');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API 1' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API 2' });
    const t3 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API 3' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, t3);
    await connect(diagramId, t3, end);

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/lanes-expected-but-missing': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lanes-expected-but-missing');
    expect(issues.length).toBe(0);
  });

  test('counts manual tasks towards the threshold', async () => {
    const diagramId = await createDiagram('Manual Tasks');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const t2 = await addElement(diagramId, 'bpmn:ManualTask', { name: 'Sign' });
    const t3 = await addElement(diagramId, 'bpmn:ManualTask', { name: 'Deliver' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, t3);
    await connect(diagramId, t3, end);

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/lanes-expected-but-missing': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lanes-expected-but-missing');
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('3 user/manual tasks');
  });
});
