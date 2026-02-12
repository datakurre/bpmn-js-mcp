import { describe, test, expect, beforeEach } from 'vitest';
import { handleGetProperties, handleSetProperties, handleAddElement } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../helpers';

describe('get_bpmn_element_properties', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('returns element properties', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
    });
    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { 'camunda:assignee': 'alice' },
    });

    const res = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    expect(res.type).toBe('bpmn:UserTask');
    expect(res.name).toBe('Review');
    expect(res.camundaProperties['camunda:assignee']).toBe('alice');
  });

  test('includes incoming/outgoing connections', async () => {
    const diagramId = await createDiagram();
    const aId = await addElement(diagramId, 'bpmn:StartEvent', {
      x: 100,
      y: 100,
    });
    const bId = await addElement(diagramId, 'bpmn:EndEvent', {
      x: 300,
      y: 100,
    });
    await connect(diagramId, aId, bId);

    const res = parseResult(await handleGetProperties({ diagramId, elementId: bId }));
    expect(res.incoming).toBeDefined();
    expect(res.incoming.length).toBe(1);
  });

  test('includes attachedToRef for boundary events', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Call API',
      x: 200,
      y: 100,
    });
    const boundaryRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Error Handler',
        hostElementId: taskId,
      })
    );
    const boundaryId = boundaryRes.elementId;

    const res = parseResult(await handleGetProperties({ diagramId, elementId: boundaryId }));
    expect(res.type).toBe('bpmn:BoundaryEvent');
    expect(res.attachedToRef).toBe(taskId);
  });
});
