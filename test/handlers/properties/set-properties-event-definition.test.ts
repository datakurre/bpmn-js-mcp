/**
 * Tests for set_bpmn_element_properties' eventDefinition sub-object (ADR-028)
 * — the former set_bpmn_event_definition, removed outright and folded in.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetProperties, handleExportBpmn, handleBpmnHistory } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('set_bpmn_element_properties — eventDefinition sub-object', () => {
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
      await handleSetProperties({
        diagramId,
        elementId: boundaryId,
        eventDefinition: {
          eventDefinitionType: 'bpmn:ErrorEventDefinition',
          errorRef: { id: 'Error_1', name: 'BusinessError', errorCode: 'ERR_001' },
        },
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).toContain('errorEventDefinition');
  });

  test('combines properties and eventDefinition in one call', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', {
      name: 'Wait',
      x: 200,
      y: 200,
    });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: eventId,
        properties: { name: 'Wait for timer' },
        eventDefinition: {
          eventDefinitionType: 'bpmn:TimerEventDefinition',
          properties: { timeDuration: 'PT15M' },
        },
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).toContain('timerEventDefinition');
    expect(xml).toContain('Wait for timer');
  });

  test('rejects eventDefinition on a non-event element', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Do it' });

    await expect(
      handleSetProperties({
        diagramId,
        elementId: taskId,
        eventDefinition: { eventDefinitionType: 'bpmn:TimerEventDefinition' },
      })
    ).rejects.toThrow();
  });

  test('applies eventDefinition within the updates (batch) form', async () => {
    const diagramId = await createDiagram();
    const event1 = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', { x: 100, y: 100 });
    const event2 = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', { x: 300, y: 100 });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        updates: [
          {
            elementId: event1,
            eventDefinition: {
              eventDefinitionType: 'bpmn:TimerEventDefinition',
              properties: { timeDuration: 'PT5M' },
            },
          },
          {
            elementId: event2,
            eventDefinition: {
              eventDefinitionType: 'bpmn:TimerEventDefinition',
              properties: { timeDuration: 'PT10M' },
            },
          },
        ],
      })
    );
    expect(res.success).toBe(true);
    expect(res.updated).toHaveLength(2);
    expect(res.updated[0].changed).toContain('eventDefinition');

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect((xml.match(/timerEventDefinition/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test('undoes a single-element eventDefinition change via bpmn_history', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', { x: 100, y: 100 });

    await handleSetProperties({
      diagramId,
      elementId: eventId,
      eventDefinition: {
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT5M' },
      },
    });

    let xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).toContain('timerEventDefinition');

    const undoResult = parseResult(
      await handleBpmnHistory({ diagramId, action: 'undo', steps: 1 })
    );
    expect(undoResult.stepsPerformed).toBe(1);

    xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).not.toContain('timerEventDefinition');
  });

  test('rolls back an eventDefinition applied by an earlier batch item when a later item fails', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', { x: 100, y: 100 });

    await expect(
      handleSetProperties({
        diagramId,
        updates: [
          {
            elementId: eventId,
            eventDefinition: {
              eventDefinitionType: 'bpmn:MessageEventDefinition',
              messageRef: { id: 'Msg_X', name: 'X' },
            },
          },
          {
            elementId: eventId,
            // Fails: no timeDuration/timeDate/timeCycle provided.
            eventDefinition: { eventDefinitionType: 'bpmn:TimerEventDefinition', properties: {} },
          },
        ],
      })
    ).rejects.toThrow(/updates\[1\]/);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).not.toContain('messageEventDefinition');
    expect(xml).not.toContain('Msg_X');
  });

  test('does not leave an orphaned root element when a later batch item fails', async () => {
    const diagramId = await createDiagram();
    const event1 = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', { x: 100, y: 100 });
    const event2 = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', { x: 300, y: 100 });

    await expect(
      handleSetProperties({
        diagramId,
        updates: [
          {
            elementId: event1,
            eventDefinition: {
              eventDefinitionType: 'bpmn:ErrorEventDefinition',
              errorRef: { id: 'Error_X', name: 'X' },
            },
          },
          {
            elementId: event2,
            eventDefinition: { eventDefinitionType: 'bpmn:TimerEventDefinition', properties: {} },
          },
        ],
      })
    ).rejects.toThrow();

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).not.toContain('Error_X');
    expect(xml).not.toContain('bpmn:error');
  });

  test('rejects a bad eventDefinition before mutating anything (pre-validation)', async () => {
    const diagramId = await createDiagram();
    const event1 = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', { x: 100, y: 100 });
    const event2 = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', { x: 300, y: 100 });

    await expect(
      handleSetProperties({
        diagramId,
        updates: [
          {
            elementId: event1,
            eventDefinition: {
              eventDefinitionType: 'bpmn:TimerEventDefinition',
              properties: { timeDuration: 'PT5M' },
            },
          },
          // Missing eventDefinitionType entirely — should be caught up front.
          { elementId: event2, eventDefinition: {} as any },
        ],
      })
    ).rejects.toThrow(/updates\[1\]/);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).not.toContain('timerEventDefinition');
  });
});
