/**
 * Tests for boundary event spreading when multiple events share the same
 * border of a host task.
 *
 * Verifies that after layout, boundary events on the same border are
 * spread evenly and do not overlap.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleConnect, handleAddElement } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams, parseResult } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('boundary event spreading', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('spreads multiple boundary events on the same host border', async () => {
    const diagramId = await createDiagram('Boundary Spread Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });

    // Add two boundary events on the same task
    const be1Res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: task,
        name: 'Timer 1',
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT15M' },
      })
    );
    const be2Res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: task,
        name: 'Timer 2',
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT30M' },
      })
    );

    // Add targets for the boundary events (so they have outgoing flows)
    const endBe1 = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End BE1' });
    const endBe2 = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End BE2' });

    await handleConnect({ diagramId, sourceElementId: be1Res.elementId, targetElementId: endBe1 });
    await handleConnect({ diagramId, sourceElementId: be2Res.elementId, targetElementId: endBe2 });

    // Run layout
    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const be1 = reg.get(be1Res.elementId);
    const be2 = reg.get(be2Res.elementId);

    expect(be1).toBeDefined();
    expect(be2).toBeDefined();

    // Both boundary events should exist at valid positions
    const be1Cx = be1.x + (be1.width || 36) / 2;
    const be2Cx = be2.x + (be2.width || 36) / 2;

    // They should NOT overlap (centres should be at least 20px apart in
    // at least one axis)
    const dxCentres = Math.abs(be1Cx - be2Cx);
    const be1Cy = be1.y + (be1.height || 36) / 2;
    const be2Cy = be2.y + (be2.height || 36) / 2;
    const dyCentres = Math.abs(be1Cy - be2Cy);

    // At least one axis should have sufficient separation
    const separated = dxCentres > 15 || dyCentres > 15;
    expect(
      separated,
      `Boundary events overlap: centres at (${be1Cx},${be1Cy}) and (${be2Cx},${be2Cy}), ` +
        `dx=${dxCentres}, dy=${dyCentres}`
    ).toBe(true);
  });
});
