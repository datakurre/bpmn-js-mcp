/**
 * Tests for automatic pool expansion during layout.
 *
 * Verifies that layout_bpmn_diagram automatically resizes pools and lanes
 * to fit all elements when the diagram contains participants, without
 * requiring explicit poolExpansion=true.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleCreateCollaboration,
  handleAddElement,
  handleConnect,
  handleWrapProcessInCollaboration,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('layout_bpmn_diagram — auto pool expansion', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('auto-enables pool expansion when diagram has participants', async () => {
    const diagramId = await createDiagram('Auto Pool Expansion');

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Main Process', width: 600, height: 250 },
          { name: 'External', collapsed: true },
        ],
      })
    );

    const poolId = collab.participantIds[0];

    // Add a chain of elements that might overflow default pool bounds
    const start = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start',
        participantId: poolId,
      })
    );
    const t1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task 1',
        participantId: poolId,
      })
    );
    const t2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task 2',
        participantId: poolId,
      })
    );
    const t3 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task 3',
        participantId: poolId,
      })
    );
    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'End',
        participantId: poolId,
      })
    );

    await handleConnect({
      diagramId,
      elementIds: [start.elementId, t1.elementId, t2.elementId, t3.elementId, end.elementId],
    });

    // Layout without explicit poolExpansion — should auto-detect pools
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Pool should have been auto-resized to fit elements
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const pool = reg.get(poolId);
    const elements = reg.filter(
      (el: any) =>
        el.type !== 'bpmn:Participant' &&
        el.type !== 'bpmn:Lane' &&
        !el.type.includes('Flow') &&
        !el.type.includes('Association') &&
        el.parent?.id === poolId
    );

    // All flow nodes should be within pool bounds
    for (const el of elements) {
      expect(el.x).toBeGreaterThanOrEqual(pool.x);
      expect(el.y).toBeGreaterThanOrEqual(pool.y);
      expect(el.x + (el.width || 0)).toBeLessThanOrEqual(pool.x + pool.width);
      expect(el.y + (el.height || 0)).toBeLessThanOrEqual(pool.y + pool.height);
    }
  });

  test('poolExpansion=false disables auto-expansion', async () => {
    const diagramId = await createDiagram('No Auto Expansion');

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Main Process' }, { name: 'External', collapsed: true }],
      })
    );

    const poolId = collab.participantIds[0];

    const start = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start',
        participantId: poolId,
      })
    );
    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'End',
        participantId: poolId,
      })
    );
    await handleConnect({
      diagramId,
      sourceElementId: start.elementId,
      targetElementId: end.elementId,
    });

    // Explicitly disable pool expansion
    const res = parseResult(await handleLayoutDiagram({ diagramId, poolExpansion: false }));
    expect(res.success).toBe(true);
    // poolExpansionApplied should not be present
    expect(res.poolExpansionApplied).toBeUndefined();
  });

  test('no auto-expansion for simple process without pools', async () => {
    const diagramId = await createDiagram('No Pools');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    // No pools = no pool expansion
    expect(res.poolExpansionApplied).toBeUndefined();
  });

  test('auto-expansion works with wrapped process', async () => {
    const diagramId = await createDiagram('Wrapped Process');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    const wrapResult = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'My Process',
      })
    );

    // Layout without explicit poolExpansion
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Verify pool contains all elements
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const pool = reg.get(wrapResult.participantIds[0]);
    expect(pool).toBeDefined();
    expect(pool.width).toBeGreaterThan(0);
    expect(pool.height).toBeGreaterThan(0);
  });
});
