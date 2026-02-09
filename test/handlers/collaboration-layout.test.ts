/**
 * Tests for collaboration layout via handleLayoutDiagram.
 *
 * Verifies that layout_bpmn_diagram works with multi-participant
 * collaboration diagrams.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleConnect,
  handleCreateCollaboration,
  handleAddElement,
} from '../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('collaboration layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('lays out a collaboration with two participants', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Customer' }, { name: 'Supplier' }],
      })
    );

    const customerPool = collab.participantIds[0];
    const _supplierPool = collab.participantIds[1];

    // Add elements to each pool
    const startRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Order Placed',
        participantId: customerPool,
      })
    );
    const taskRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Process Order',
        participantId: customerPool,
      })
    );
    const endRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Order Done',
        participantId: customerPool,
      })
    );

    await handleConnect({
      diagramId,
      sourceElementId: startRes.elementId,
      targetElementId: taskRes.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: taskRes.elementId,
      targetElementId: endRes.elementId,
    });

    // Run layout
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.elementCount).toBeGreaterThanOrEqual(2);
  });

  it('supports layout direction parameter', async () => {
    const diagramId = await createDiagram('Direction Test');
    const startRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Begin',
      })
    );
    const endRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Finish',
      })
    );
    await handleConnect({
      diagramId,
      sourceElementId: startRes.elementId,
      targetElementId: endRes.elementId,
    });

    // Layout with DOWN direction (top-to-bottom)
    const res = parseResult(await handleLayoutDiagram({ diagramId, direction: 'DOWN' }));
    expect(res.success).toBe(true);

    // Verify top-to-bottom ordering
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const startEl = reg.get(startRes.elementId);
    const endEl = reg.get(endRes.elementId);

    // In DOWN direction, start should be above (lower y) than end
    expect(startEl.y).toBeLessThan(endEl.y);
  });

  it('supports node and layer spacing parameters', async () => {
    const diagramId = await createDiagram('Spacing Test');
    const startRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'S',
      })
    );
    const endRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'E',
      })
    );
    await handleConnect({
      diagramId,
      sourceElementId: startRes.elementId,
      targetElementId: endRes.elementId,
    });

    // Layout with custom spacing
    const res = parseResult(
      await handleLayoutDiagram({ diagramId, nodeSpacing: 100, layerSpacing: 100 })
    );
    expect(res.success).toBe(true);
  });
});
