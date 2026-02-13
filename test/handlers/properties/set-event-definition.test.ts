import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetEventDefinition, handleExportBpmn } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('set_bpmn_event_definition', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('adds an error event definition to a boundary event', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'My Task',
      x: 200,
      y: 200,
    });
    const boundaryId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      hostElementId: taskId,
      x: 220,
      y: 260,
    });

    const res = parseResult(
      await handleSetEventDefinition({
        diagramId,
        elementId: boundaryId,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        errorRef: {
          id: 'Error_1',
          name: 'BusinessError',
          errorCode: 'ERR_001',
        },
      })
    );
    expect(res.success).toBe(true);

    // Verify via XML
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('errorEventDefinition');
  });

  test('adds a timer event definition', async () => {
    const diagramId = await createDiagram();
    const catchId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', { x: 200, y: 200 });

    const res = parseResult(
      await handleSetEventDefinition({
        diagramId,
        elementId: catchId,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT1H' },
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('timerEventDefinition');
  });

  test('throws for non-event element', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Not event',
    });

    await expect(
      handleSetEventDefinition({
        diagramId,
        elementId: taskId,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
      })
    ).rejects.toThrow(/not an event/);
  });

  test('sets camunda:async on SignalEventDefinition', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateThrowEvent', {
      name: 'Signal Throw',
      x: 200,
      y: 100,
    });

    const res = parseResult(
      await handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:SignalEventDefinition',
        signalRef: { id: 'Signal_1', name: 'MySignal' },
        properties: { async: true },
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:async="true"');
    expect(xml).toContain('signalEventDefinition');
  });

  test('sets camunda:in variable mappings on SignalEventDefinition', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateThrowEvent', {
      name: 'Send Signal',
      x: 200,
      y: 100,
    });

    const res = parseResult(
      await handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:SignalEventDefinition',
        signalRef: { id: 'Signal_Order', name: 'OrderCompleted' },
        inMappings: [
          { source: 'orderId', target: 'orderId' },
          { source: 'customerName', target: 'customerName' },
        ],
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:in');
    expect(xml).toContain('source="orderId"');
    expect(xml).toContain('target="customerName"');
  });

  test('sets camunda:in with variables="all" on SignalEventDefinition', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateThrowEvent', {
      name: 'Broadcast Signal',
      x: 200,
      y: 100,
    });

    const res = parseResult(
      await handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:SignalEventDefinition',
        signalRef: { id: 'Signal_Broadcast', name: 'BroadcastAll' },
        inMappings: [{ variables: 'all' }],
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:in');
    expect(xml).toContain('variables="all"');
  });

  test('rejects inMappings on non-Signal event definitions', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', {
      x: 200,
      y: 100,
    });

    await expect(
      handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT1H' },
        inMappings: [{ source: 'foo', target: 'bar' }],
      })
    ).rejects.toThrow(/only supported on bpmn:SignalEventDefinition/);
  });
});
