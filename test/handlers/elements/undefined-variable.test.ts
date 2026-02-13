import { describe, test, expect, beforeEach } from 'vitest';
import { handleLintDiagram, handleSetFormData, handleSetProperties } from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  clearDiagrams,
  connect,
  createSimpleProcess,
} from '../../helpers';

describe('undefined-variable rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when condition expression references undefined variable', async () => {
    const diagramId = await createDiagram('Undefined Var Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check?' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskA, { conditionExpression: '${approved == true}' });
    await connect(diagramId, gw, taskB);
    await connect(diagramId, taskA, end);
    await connect(diagramId, taskB, end);

    // Set taskB flow as default
    await handleSetProperties({
      diagramId,
      elementId: gw,
      properties: { default: (await getOutgoing(diagramId, gw))[1] },
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/undefined-variable': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/undefined-variable');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('approved');
  });

  test('does not warn when variable is defined by a form field', async () => {
    const diagramId = await createDiagram('Defined Var Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const formTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Fill Form' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Order' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, formTask);
    await connect(diagramId, formTask, gw);
    await connect(diagramId, gw, taskA, { conditionExpression: '${approved == true}' });
    await connect(diagramId, gw, end);
    await connect(diagramId, taskA, end);

    // Define the 'approved' variable via form field
    await handleSetFormData({
      diagramId,
      elementId: formTask,
      fields: [{ id: 'approved', label: 'Approved?', type: 'boolean' }],
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/undefined-variable': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/undefined-variable');
    // 'approved' is defined by form field, so should not be reported
    const approvedIssues = issues.filter((i: any) => i.message.includes('approved'));
    expect(approvedIssues.length).toBe(0);
  });

  test('does not warn for JUEL built-in variables', async () => {
    const diagramId = await createDiagram('Builtin Var Test');
    const { task } = await createSimpleProcess(diagramId);

    // Set a condition that uses execution (built-in)
    // We need to add a gateway with a condition that uses 'execution'
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check?' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Alt Path' });
    const end2 = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End 2' });

    await connect(diagramId, task, gw);
    await connect(diagramId, gw, taskB, {
      conditionExpression: '${execution.getVariable("test") != null}',
    });
    await connect(diagramId, gw, end2);
    await connect(diagramId, taskB, end2);

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/undefined-variable': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/undefined-variable');
    // 'execution' is a built-in, should not be reported
    const executionIssues = issues.filter((i: any) => i.message.includes('"execution"'));
    expect(executionIssues.length).toBe(0);
  });

  test('does not warn when variable is defined by script result variable', async () => {
    const diagramId = await createDiagram('Script Result Var');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const script = await addElement(diagramId, 'bpmn:ScriptTask', { name: 'Calculate Total' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Total high?' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review High' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, script);
    await connect(diagramId, script, gw);
    await connect(diagramId, gw, taskA, { conditionExpression: '${total > 1000}' });
    await connect(diagramId, gw, end);
    await connect(diagramId, taskA, end);

    // Define 'total' via resultVariable
    await handleSetProperties({
      diagramId,
      elementId: script,
      properties: { 'camunda:resultVariable': 'total' },
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/undefined-variable': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/undefined-variable');
    const totalIssues = issues.filter((i: any) => i.message.includes('"total"'));
    expect(totalIssues.length).toBe(0);
  });
});

// Helper to get outgoing flow IDs from a gateway
async function getOutgoing(diagramId: string, elementId: string): Promise<string[]> {
  const { getDiagram } = await import('../../../src/diagram-manager');
  const diagram = getDiagram(diagramId)!;
  const el = diagram.modeler.get('elementRegistry').get(elementId);
  return (el?.outgoing || []).map((f: any) => f.id);
}
