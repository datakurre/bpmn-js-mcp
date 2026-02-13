import { describe, test, expect, beforeEach } from 'vitest';
import { handleValidate } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('bpmnlint: inconsistent-lane-naming', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('reports placeholder lane names', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 300,
      y: 300,
    });
    // Create lanes with generic names by adding them directly
    await addElement(diagramId, 'bpmn:Lane', { name: 'Lane 1' });
    await addElement(diagramId, 'bpmn:Lane', { name: 'Lane 2' });

    const res = parseResult(await handleValidate({ diagramId }));

    // Should have inconsistent-lane-naming issues
    const laneNamingIssues = (res.issues || []).filter(
      (i: any) => i.rule === 'bpmn-mcp/inconsistent-lane-naming'
    );
    expect(laneNamingIssues.length).toBeGreaterThan(0);
  });

  test('does not report proper role-based names', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 300,
      y: 300,
    });
    await addElement(diagramId, 'bpmn:Lane', { name: 'Manager' });
    await addElement(diagramId, 'bpmn:Lane', { name: 'Finance Team' });

    const res = parseResult(await handleValidate({ diagramId }));

    const laneNamingIssues = (res.issues || []).filter(
      (i: any) => i.rule === 'bpmn-mcp/inconsistent-lane-naming'
    );
    expect(laneNamingIssues.length).toBe(0);
  });
});
