import { describe, test, expect, beforeEach } from 'vitest';
import { handleValidate as handleLintDiagram } from '../../../src/handlers/core/validate';

import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';

describe('validate_bpmn_diagram — lint', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('returns errors for empty process (no start/end events)', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(await handleLintDiagram({ diagramId }));

    expect(res.success).toBe(true);
    expect(res.valid).toBe(false);
    expect(res.errorCount).toBeGreaterThan(0);
    expect(res.issues.some((i: any) => i.rule === 'start-event-required')).toBe(true);
    expect(res.issues.some((i: any) => i.rule === 'end-event-required')).toBe(true);
  });

  test('returns no start/end event errors for valid start → task → end process', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Do something',
      x: 250,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { x: 400, y: 100 });
    await connect(diagramId, startId, taskId);
    await connect(diagramId, taskId, endId);

    const res = parseResult(await handleLintDiagram({ diagramId }));
    // Should not have start/end event required errors
    expect(res.issues.filter((i: any) => i.rule === 'start-event-required')).toHaveLength(0);
    expect(res.issues.filter((i: any) => i.rule === 'end-event-required')).toHaveLength(0);
  });

  test('reports disconnected element', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Task', { name: 'Lonely' });
    const res = parseResult(await handleLintDiagram({ diagramId }));

    // Should have no-disconnected or no-implicit-start/end issues
    const hasDisconnected = res.issues.some(
      (i: any) =>
        i.rule === 'no-disconnected' ||
        i.rule === 'no-implicit-start' ||
        i.rule === 'no-implicit-end'
    );
    expect(hasDisconnected).toBe(true);
  });

  test('supports custom config override to suppress rules', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'bpmnlint:recommended',
          rules: {
            'end-event-required': 'off',
            'start-event-required': 'off',
            'label-required': 'off',
            'no-overlapping-elements': 'off',
            'no-disconnected': 'off',
          },
        },
      })
    );

    // With start/end event rules turned off, an empty process should have no issues from them
    expect(res.issues.filter((i: any) => i.rule === 'end-event-required')).toHaveLength(0);
    expect(res.issues.filter((i: any) => i.rule === 'start-event-required')).toHaveLength(0);
  });

  test('issues have proper structure (rule, severity, message)', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Task');
    const res = parseResult(await handleLintDiagram({ diagramId }));

    expect(res.issues.length).toBeGreaterThan(0);
    for (const issue of res.issues) {
      expect(issue).toHaveProperty('rule');
      expect(issue).toHaveProperty('severity');
      expect(issue).toHaveProperty('message');
      expect(['error', 'warning', 'info']).toContain(issue.severity);
    }
  });
});
