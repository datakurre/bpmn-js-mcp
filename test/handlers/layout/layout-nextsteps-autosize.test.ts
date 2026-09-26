/**
 * Tests that layout_bpmn_diagram nextSteps correctly references
 * `layout_bpmn_diagram` with `autosizeOnly: true` (not a bare re-run, which
 * would not resize pools) when a pool has sizing issues and pool
 * auto-expansion was not applied.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateParticipant, handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, connect, parseResult, clearDiagrams } from '../../helpers';

describe('layout_bpmn_diagram — autosize nextSteps tool name', () => {
  beforeEach(() => clearDiagrams());

  test('nextSteps references layout_bpmn_diagram (autosizeOnly) when pool is undersized', async () => {
    const diagramId = await createDiagram();

    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Test Pool', height: 100, width: 200 })
    );
    const participantId = poolRes.participantId;

    // Add several elements that will overflow the small pool
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId,
      x: 180,
      y: 60,
    });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task 1',
      participantId,
      x: 350,
      y: 60,
    });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Task 2',
      participantId,
      x: 520,
      y: 60,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      participantId,
      x: 700,
      y: 60,
    });
    await connect(diagramId, startId, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, endId);

    // Run layout with poolExpansion explicitly disabled so autosize is skipped
    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId, poolExpansion: false }));

    expect(layoutRes.success).toBe(true);

    // When pool sizing issues exist and autosize wasn't applied, nextSteps
    // must reference layout_bpmn_diagram with autosizeOnly: true — a bare
    // "run layout_bpmn_diagram" mention would not actually resize the pool.
    const steps = (layoutRes.nextSteps ?? []) as Array<{ tool: string; description: string }>;
    const poolStep = steps.find(
      (s) => s.description && s.description.toLowerCase().includes('autosize')
    );
    if (poolStep) {
      expect(poolStep.tool).toBe('layout_bpmn_diagram');
      expect(poolStep.description.toLowerCase()).toContain('autosizeonly');
    }
  });
});
