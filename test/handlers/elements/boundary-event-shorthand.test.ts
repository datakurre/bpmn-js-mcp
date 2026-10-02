import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement, handleGetProperties, handleSetProperties } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('add_bpmn_elements — boundary event shorthand', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates boundary event with error event definition in one call', async () => {
    const diagramId = await createDiagram('BEShorthand');
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Do Work' });

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Error Handler',
        hostElementId: taskId,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        errorRef: { id: 'Error_Payment', name: 'PaymentError', errorCode: 'PAY_001' },
      } as any)
    );

    expect(res.success).toBe(true);
    expect(res.eventDefinitionType).toBe('bpmn:ErrorEventDefinition');
    expect(res.attachedTo).toBeDefined();
    expect(res.attachedTo.hostElementId).toBe(taskId);

    // Verify event definition was actually set
    const props = parseResult(await handleGetProperties({ diagramId, elementId: res.elementId }));
    expect(props.eventDefinitions).toBeDefined();
    expect(props.eventDefinitions.length).toBe(1);
    expect(props.eventDefinitions[0].type).toBe('bpmn:ErrorEventDefinition');
  });

  test('creates boundary event with timer event definition in one call', async () => {
    const diagramId = await createDiagram('TimerShorthand');
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Wait Task' });

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Timeout',
        hostElementId: taskId,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT30M' },
      } as any)
    );

    expect(res.success).toBe(true);
    expect(res.eventDefinitionType).toBe('bpmn:TimerEventDefinition');
  });

  test('creates intermediate catch event with message definition', async () => {
    const diagramId = await createDiagram('MsgShorthand');

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:IntermediateCatchEvent',
        name: 'Wait for Reply',
        eventDefinitionType: 'bpmn:MessageEventDefinition',
        messageRef: { id: 'Message_Reply', name: 'ReplyReceived' },
      } as any)
    );

    expect(res.success).toBe(true);
    expect(res.eventDefinitionType).toBe('bpmn:MessageEventDefinition');
  });

  test('creates end event with terminate definition', async () => {
    const diagramId = await createDiagram('TermShorthand');

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Kill Process',
        eventDefinitionType: 'bpmn:TerminateEventDefinition',
      } as any)
    );

    expect(res.success).toBe(true);
    expect(res.eventDefinitionType).toBe('bpmn:TerminateEventDefinition');
  });

  test('works without eventDefinitionType (no change to existing behavior)', async () => {
    const diagramId = await createDiagram('NoEvtDef');

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start',
      })
    );

    expect(res.success).toBe(true);
    expect(res.eventDefinitionType).toBeUndefined();
  });

  test('cancelActivity:false creates non-interrupting boundary event', async () => {
    const diagramId = await createDiagram('NonInterrupting');
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Long Task' });

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Reminder',
        hostElementId: taskId,
        cancelActivity: false,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT48H' },
      } as any)
    );

    expect(res.success).toBe(true);
    // Verify cancelActivity was set on the business object
    const props = parseResult(await handleGetProperties({ diagramId, elementId: res.elementId }));
    expect(props.cancelActivity).toBe(false);
  });

  test('cancelActivity defaults to true (interrupting) when not specified', async () => {
    const diagramId = await createDiagram('DefaultInterrupting');
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Error Handler',
        hostElementId: taskId,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        errorRef: { id: 'Error_X', name: 'ErrorX' },
      } as any)
    );

    expect(res.success).toBe(true);
    const props = parseResult(await handleGetProperties({ diagramId, elementId: res.elementId }));
    // Default is cancelActivity: true (interrupting) — the property may be absent (defaults to true)
    expect(props.cancelActivity === undefined || props.cancelActivity === true).toBe(true);
  });

  test('set_bpmn_element_properties can update cancelActivity to false on a boundary event', async () => {
    const diagramId = await createDiagram('SetCancelActivity');
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    // Create interrupting boundary event
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Timer',
        hostElementId: taskId,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT1H' },
      } as any)
    );
    expect(res.success).toBe(true);
    const beId = res.elementId;

    // Change to non-interrupting via set_bpmn_element_properties
    const setPropRes = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: beId,
        properties: { cancelActivity: false },
      })
    );
    expect(setPropRes.success).toBe(true);

    // Verify
    const props = parseResult(await handleGetProperties({ diagramId, elementId: beId }));
    expect(props.cancelActivity).toBe(false);
  });

  test('timer boundary event response includes cancelActivity hint in nextSteps', async () => {
    const diagramId = await createDiagram('TimerHint');
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Timeout',
        hostElementId: taskId,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT30M' },
      } as any)
    );
    expect(res.success).toBe(true);
    // nextSteps should mention cancelActivity for timer boundary events
    const steps: Array<{ tool: string; description: string }> = res.nextSteps ?? [];
    const cancelHint = steps.find((s) => s.description.includes('cancelActivity'));
    expect(cancelHint).toBeDefined();
  });
});
