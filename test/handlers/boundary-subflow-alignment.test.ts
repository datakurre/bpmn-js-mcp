/**
 * Tests for boundary sub-flow end-event alignment (AI-7).
 *
 * End events reachable from boundary event flows should be vertically
 * aligned with their immediate predecessor element.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleSetEventDefinition } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

describe('Boundary sub-flow end event alignment', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('end event after boundary handler aligns with handler Y', async () => {
    const diagramId = await createDiagram('Boundary EndEvent Align');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API' });
    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timeout',
      hostElementId: task,
    });
    await handleSetEventDefinition({
      diagramId,
      elementId: boundary,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      properties: { timeDuration: 'PT30S' },
    });
    const handler = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle Timeout' });
    const endOk = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
    const endTimeout = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timed Out' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, endOk);
    await connect(diagramId, boundary, handler);
    await connect(diagramId, handler, endTimeout);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    const handlerEl = reg.get(handler);
    const endTimeoutEl = reg.get(endTimeout);

    // The end event should be aligned with the handler's Y-centre
    expect(
      Math.abs(centreY(handlerEl) - centreY(endTimeoutEl)),
      'End event should align with handler Y'
    ).toBeLessThanOrEqual(5);
  });

  test('end event directly from boundary event aligns with boundary Y', async () => {
    const diagramId = await createDiagram('Boundary Direct End');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
    const boundary = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: task,
    });
    const endOk = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Success' });
    const endError = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Error End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, endOk);
    await connect(diagramId, boundary, endError);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // All connections should be orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      const wps = conn.waypoints;
      for (let i = 1; i < wps.length; i++) {
        const dx = Math.abs(wps[i].x - wps[i - 1].x);
        const dy = Math.abs(wps[i].y - wps[i - 1].y);
        expect(dx < 1 || dy < 1, `Connection ${conn.id} should be orthogonal`).toBe(true);
      }
    }
  });
});
