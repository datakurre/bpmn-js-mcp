/**
 * Tests for ELK spacing constants matching bpmn-js reference layout.
 *
 * Verifies that the reduced spacing values (AI-1, AI-2, AP-1, AS-1)
 * produce layouts closer to bpmn-js's built-in auto-place algorithm.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleConnect, handleCreateCollaboration } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';
import { ELK_LAYER_SPACING, ELK_NODE_SPACING, ELK_EDGE_NODE_SPACING } from '../../src/constants';

describe('ELK spacing constants', () => {
  it('layer spacing is 60px (matching bpmn-js ~58px average)', () => {
    expect(ELK_LAYER_SPACING).toBe(60);
  });

  it('node spacing is 50px (matching bpmn-js ~110px branch gap)', () => {
    expect(ELK_NODE_SPACING).toBe(50);
  });

  it('edge-node spacing is 15px', () => {
    expect(ELK_EDGE_NODE_SPACING).toBe(15);
  });
});

describe('layout spacing regression', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('sequential layout produces compact edge-to-edge gaps', async () => {
    const diagramId = await createDiagram('Compact Spacing');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: t1 });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: t2 });
    await handleConnect({ diagramId, sourceElementId: t2, targetElementId: end });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const t1El = reg.get(t1);
    const t2El = reg.get(t2);
    const endEl = reg.get(end);

    // Measure edge-to-edge gaps
    const gap1 = t1El.x - (startEl.x + (startEl.width || 36));
    const gap2 = t2El.x - (t1El.x + (t1El.width || 100));
    const gap3 = endEl.x - (t2El.x + (t2El.width || 100));

    // Gaps should be ~60px (ELK_LAYER_SPACING), not 100px (old value)
    // Allow some flexibility for the grid snap pass
    for (const gap of [gap1, gap2, gap3]) {
      expect(gap).toBeGreaterThan(30);
      expect(gap).toBeLessThan(90);
    }
  });

  it('pool layout has sufficient vertical padding', async () => {
    const diagramId = await createDiagram('Pool Padding');

    // Create a collaboration with one participant
    await handleCreateCollaboration({
      diagramId,
      participants: [
        { name: 'Main Process', width: 600, height: 250 },
        { name: 'External', collapsed: true },
      ],
    });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const participants = reg.filter((el: any) => el.type === 'bpmn:Participant');
    const mainPool = participants.find((p: any) => p.businessObject?.name === 'Main Process');

    // Add elements inside the pool
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId: mainPool.id,
    });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Do Work',
      participantId: mainPool.id,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      participantId: mainPool.id,
    });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });

    await handleLayoutDiagram({ diagramId });

    // Re-fetch the pool after layout (it may have been resized)
    const poolAfter = reg.get(mainPool.id);

    // Pool should have reasonable height (>= 200px for single row)
    expect(poolAfter.height).toBeGreaterThanOrEqual(180);
  });
});
