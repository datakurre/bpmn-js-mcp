/**
 * Tests for boundary event label positioning after layout.
 *
 * Verifies that boundary event labels stay near their events after
 * layout repositions them, and that boundary events prefer the
 * bottom border of their host (BPMN convention).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleConnect, handleLayoutDiagram, handleAddElement } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('boundary event layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('boundary event labels stay near their events after layout', async () => {
    const diagramId = await createDiagram('Boundary Label Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });

    // Add boundary error event
    const beRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Timeout',
        hostElementId: task,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
      })
    );
    const beId = beRes.elementId;

    // Add target for boundary flow
    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timed Out' });
    await handleConnect({ diagramId, sourceElementId: beId, targetElementId: errorEnd });

    // Run layout
    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const beEl = reg.get(beId);

    // Boundary event should have a valid position (not negative)
    expect(beEl.x).toBeGreaterThan(0);
    expect(beEl.y).toBeGreaterThan(0);

    // If the boundary event has a label, it should be near the event
    if (beEl.label) {
      const beCx = beEl.x + (beEl.width || 36) / 2;
      const beCy = beEl.y + (beEl.height || 36) / 2;
      const labelCx = beEl.label.x + (beEl.label.width || 90) / 2;
      const labelCy = beEl.label.y + (beEl.label.height || 20) / 2;

      // Label should be within 100px of the event (not at negative coords)
      expect(Math.abs(labelCx - beCx)).toBeLessThan(100);
      expect(Math.abs(labelCy - beCy)).toBeLessThan(100);
      expect(beEl.label.x).toBeGreaterThan(-50);
      expect(beEl.label.y).toBeGreaterThan(-50);
    }
  });

  it('boundary event prefers bottom border of host', async () => {
    const diagramId = await createDiagram('Boundary Bottom Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });

    // Add boundary event with downward target
    const beRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Error',
        hostElementId: task,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
      })
    );
    const beId = beRes.elementId;

    const errorEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Failed' });
    await handleConnect({ diagramId, sourceElementId: beId, targetElementId: errorEnd });

    // Run layout
    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const beEl = reg.get(beId);
    const hostEl = reg.get(task);

    // Boundary event should be near the bottom of the host task
    const beCy = beEl.y + (beEl.height || 36) / 2;
    const hostBottom = hostEl.y + (hostEl.height || 80);

    // beCy should be at or near hostBottom (within boundary event radius)
    expect(Math.abs(beCy - hostBottom)).toBeLessThan(30);
  });
});
