import { describe, test, expect, beforeEach } from 'vitest';
import { handleLintDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('naming-convention: technical name detection', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  const lintConfig = {
    extends: 'plugin:bpmn-mcp/recommended',
    rules: { 'bpmn-mcp/naming-convention': 'warn' },
  };

  test('warns on camelCase task names', async () => {
    const diagramId = await createDiagram('Technical Names');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'processOrder' });

    const res = parseResult(await handleLintDiagram({ diagramId, config: lintConfig }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/naming-convention');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('technical identifier');
  });

  test('warns on PascalCase task names', async () => {
    const diagramId = await createDiagram('Technical Names');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'ProcessOrder' });

    const res = parseResult(await handleLintDiagram({ diagramId, config: lintConfig }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/naming-convention');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('technical identifier');
  });

  test('warns on snake_case task names', async () => {
    const diagramId = await createDiagram('Technical Names');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'process_order' });

    const res = parseResult(await handleLintDiagram({ diagramId, config: lintConfig }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/naming-convention');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('technical identifier');
  });

  test('warns on auto-generated ID-style names', async () => {
    const diagramId = await createDiagram('Technical Names');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'ServiceTask_0x1f3a' });

    const res = parseResult(await handleLintDiagram({ diagramId, config: lintConfig }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/naming-convention');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('technical identifier');
  });

  test('does not warn on proper human-readable names', async () => {
    const diagramId = await createDiagram('Good Names');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Order' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Application' });
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Order Received' });

    const res = parseResult(await handleLintDiagram({ diagramId, config: lintConfig }));
    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/naming-convention' && i.message.includes('technical')
    );
    expect(issues.length).toBe(0);
  });

  test('does not warn on single words', async () => {
    const diagramId = await createDiagram('Single Words');
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const res = parseResult(await handleLintDiagram({ diagramId, config: lintConfig }));
    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/naming-convention' && i.message.includes('technical')
    );
    expect(issues.length).toBe(0);
  });
});
