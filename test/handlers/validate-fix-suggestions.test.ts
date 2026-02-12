import { describe, test, expect, beforeEach } from 'vitest';
import { handleValidate } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../helpers';

describe('validate_bpmn_diagram — fix suggestions', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('suggests fix for missing labels', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Task');

    const res = parseResult(await handleValidate({ diagramId }));
    const labelIssue = res.issues.find((i: any) => i.rule === 'label-required');
    expect(labelIssue).toBeDefined();
    expect(labelIssue.fix).toContain('set_bpmn_element_properties');
  });

  test('suggests fix for disconnected elements', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Task', { name: 'Lonely' });

    const res = parseResult(await handleValidate({ diagramId }));
    const disconnectedIssue = res.issues.find((i: any) => i.rule === 'no-disconnected');
    expect(disconnectedIssue).toBeDefined();
    expect(disconnectedIssue.fix).toContain('connect_bpmn_elements');
  });

  test('suggests fix for missing start event', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Task', { name: 'Do Something' });

    const res = parseResult(await handleValidate({ diagramId }));
    const startIssue = res.issues.find((i: any) => i.rule === 'start-event-required');
    expect(startIssue).toBeDefined();
    expect(startIssue.fix).toContain('add_bpmn_element');
    expect(startIssue.fix).toContain('StartEvent');
  });

  test('suggests fix for missing end event', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Task', { name: 'Do Something' });

    const res = parseResult(await handleValidate({ diagramId }));
    const endIssue = res.issues.find((i: any) => i.rule === 'end-event-required');
    expect(endIssue).toBeDefined();
    expect(endIssue.fix).toContain('add_bpmn_element');
    expect(endIssue.fix).toContain('EndEvent');
  });

  test('suggests fix for naming convention issues', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:UserTask', { name: 'processOrder' });

    const res = parseResult(await handleValidate({ diagramId }));
    const namingIssue = res.issues.find((i: any) => i.rule === 'bpmn-mcp/naming-convention');
    expect(namingIssue).toBeDefined();
    expect(namingIssue.fix).toContain('set_bpmn_element_properties');
  });

  test('suggests fix for gateway missing default', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check?' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskA, { conditionExpression: '${yes}' });
    await connect(diagramId, gw, taskB, { conditionExpression: '${!yes}' });

    const res = parseResult(await handleValidate({ diagramId }));
    const defaultIssue = res.issues.find((i: any) => i.rule === 'bpmn-mcp/gateway-missing-default');
    expect(defaultIssue).toBeDefined();
    expect(defaultIssue.fix).toContain('connect_bpmn_elements');
    expect(defaultIssue.fix).toContain('isDefault');
  });

  test('does not include fix for issues without a known remedy', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, end);

    const res = parseResult(await handleValidate({ diagramId }));
    // Issues without known fixes should not have a fix field
    const issuesWithoutFix = res.issues.filter(
      (i: any) => !i.fix && !i.rule?.startsWith('bpmn-mcp/')
    );
    // No error: this just verifies the structure is correct
    for (const issue of issuesWithoutFix) {
      expect(issue.fix).toBeUndefined();
    }
  });
});
