import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateDiagram } from '../../../src/handlers';
import { parseResult, clearDiagrams } from '../../helpers';

describe('create_bpmn_diagram workflowContext', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('returns lane guidance for single-organization context', async () => {
    const res = parseResult(
      await handleCreateDiagram({
        name: 'HR Onboarding',
        workflowContext: 'single-organization',
      })
    );

    expect(res.success).toBe(true);
    expect(res.workflowContext).toBe('single-organization');
    expect(res.structureGuidance).toBeDefined();
    expect(res.structureGuidance).toContain('lane');

    // Should suggest create_bpmn_participant with lanes as first step
    const collabStep = res.nextSteps.find((s: any) => s.tool === 'create_bpmn_participant');
    expect(collabStep).toBeDefined();
    expect(collabStep.description).toContain('lanes');
  });

  test('returns collaboration guidance for multi-organization context', async () => {
    const res = parseResult(
      await handleCreateDiagram({
        name: 'Order System',
        workflowContext: 'multi-organization',
      })
    );

    expect(res.success).toBe(true);
    expect(res.workflowContext).toBe('multi-organization');
    expect(res.structureGuidance).toContain('collaboration');

    const collabStep = res.nextSteps.find((s: any) => s.tool === 'create_bpmn_participant');
    expect(collabStep).toBeDefined();
    expect(collabStep.description).toContain('collapsed');
  });

  test('returns system guidance for multi-system context', async () => {
    const res = parseResult(
      await handleCreateDiagram({
        name: 'Integration Flow',
        workflowContext: 'multi-system',
      })
    );

    expect(res.success).toBe(true);
    expect(res.workflowContext).toBe('multi-system');
    expect(res.structureGuidance).toContain('system');
  });

  test('works without workflowContext (default behavior unchanged)', async () => {
    const res = parseResult(await handleCreateDiagram({ name: 'Simple Process' }));

    expect(res.success).toBe(true);
    expect(res.workflowContext).toBeUndefined();
    expect(res.structureGuidance).toBeUndefined();

    // Should have standard nextSteps
    const addStep = res.nextSteps.find((s: any) => s.tool === 'add_bpmn_element');
    expect(addStep).toBeDefined();
  });

  test('combines workflowContext with draftMode', async () => {
    const res = parseResult(
      await handleCreateDiagram({
        name: 'Draft Process',
        workflowContext: 'single-organization',
        draftMode: true,
      })
    );

    expect(res.success).toBe(true);
    expect(res.draftMode).toBe(true);
    expect(res.workflowContext).toBe('single-organization');
    expect(res.structureGuidance).toBeDefined();
  });
});
