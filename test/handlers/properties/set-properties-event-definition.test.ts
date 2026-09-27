/**
 * Tests for set_bpmn_element_properties' eventDefinition sub-object (ADR-028)
 * — the former set_bpmn_event_definition, removed outright and folded in.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetProperties, handleExportBpmn } from '../../../src/handlers';
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
});
