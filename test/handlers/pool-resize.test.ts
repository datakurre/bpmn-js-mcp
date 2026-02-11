/**
 * Tests for pool auto-resize after ELK layout.
 *
 * Verifies that participants are resized to fit their contents
 * after layout — they should NOT stay at their default 600×250.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleConnect,
  handleCreateCollaboration,
  handleAddElement,
} from '../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('pool auto-resize after layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('resizes participant pools to fit their children', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Process A' }, { name: 'Process B' }],
      })
    );

    const poolA = collab.participantIds[0];
    const poolB = collab.participantIds[1];

    // Add a simple flow to pool A (start → task1 → task2 → task3 → end)
    const s1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start A',
        participantId: poolA,
      })
    );
    const t1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task A1',
        participantId: poolA,
      })
    );
    const t2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task A2',
        participantId: poolA,
      })
    );
    const t3 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task A3',
        participantId: poolA,
      })
    );
    const e1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'End A',
        participantId: poolA,
      })
    );

    await handleConnect({
      diagramId,
      elementIds: [s1.elementId, t1.elementId, t2.elementId, t3.elementId, e1.elementId],
    });

    // Add a shorter flow to pool B (start → task → end)
    const s2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start B',
        participantId: poolB,
      })
    );
    const t4 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Task B1',
        participantId: poolB,
      })
    );
    const e2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'End B',
        participantId: poolB,
      })
    );

    await handleConnect({ diagramId, elementIds: [s2.elementId, t4.elementId, e2.elementId] });

    // Record sizes before layout
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const poolABefore = reg.get(poolA);
    const poolBBefore = reg.get(poolB);

    const poolAWidthBefore = poolABefore.width;
    const poolBWidthBefore = poolBBefore.width;

    // Run layout
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // After layout, pools should have been resized
    const poolAAfter = reg.get(poolA);
    const poolBAfter = reg.get(poolB);

    // Pool A has more elements, so it should be wider than pool B
    // (or at least different from the default 600)
    expect(poolAAfter.width).not.toBe(poolAWidthBefore);
    expect(poolBAfter.width).not.toBe(poolBWidthBefore);

    // Pool A (5 elements) should be wider than pool B (3 elements)
    expect(poolAAfter.width).toBeGreaterThan(poolBAfter.width);

    // Both pools should have reasonable heights (not the default 250 if content is smaller)
    expect(poolAAfter.height).toBeGreaterThan(0);
    expect(poolBAfter.height).toBeGreaterThan(0);

    // All children of pool A should be inside pool A's bounds
    const poolAChildren = reg.filter((el: any) => el.parent?.id === poolA && el.type !== 'label');
    for (const child of poolAChildren) {
      if (child.type?.includes('Flow') || child.type?.includes('Association')) continue;
      expect(child.x).toBeGreaterThanOrEqual(poolAAfter.x);
      expect(child.y).toBeGreaterThanOrEqual(poolAAfter.y);
      expect(child.x + (child.width || 0)).toBeLessThanOrEqual(poolAAfter.x + poolAAfter.width);
      expect(child.y + (child.height || 0)).toBeLessThanOrEqual(poolAAfter.y + poolAAfter.height);
    }
  });

  test('boundary events stay near their host after layout', async () => {
    const diagramId = await createDiagram();

    // Simple process with a task and boundary event
    const startRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent', name: 'Start' })
    );
    const taskRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:UserTask', name: 'Main Task' })
    );
    const endRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:EndEvent', name: 'Done' })
    );
    const boundaryRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Timeout',
        hostElementId: taskRes.elementId,
      })
    );
    const errorEndRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:EndEvent', name: 'Timed Out' })
    );

    await handleConnect({
      diagramId,
      elementIds: [startRes.elementId, taskRes.elementId, endRes.elementId],
    });
    await handleConnect({
      diagramId,
      sourceElementId: boundaryRes.elementId,
      targetElementId: errorEndRes.elementId,
    });

    // Run layout
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // After layout, boundary event should be near its host
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const host = reg.get(taskRes.elementId);
    const boundary = reg.get(boundaryRes.elementId);

    const hostCx = host.x + host.width / 2;
    const hostCy = host.y + host.height / 2;
    const beCx = boundary.x + (boundary.width || 36) / 2;
    const beCy = boundary.y + (boundary.height || 36) / 2;

    // Boundary event center should be within 100px of host center
    const distance = Math.sqrt((hostCx - beCx) ** 2 + (hostCy - beCy) ** 2);
    expect(distance).toBeLessThan(100);
  });
});
