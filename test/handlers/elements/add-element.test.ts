import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement, handleListElements } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('add_bpmn_element', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('adds a start event and returns its id', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Begin',
        x: 150,
        y: 200,
      })
    );
    expect(res.success).toBe(true);
    expect(res.elementId).toBeDefined();
    expect(res.elementType).toBe('bpmn:StartEvent');
  });

  test('throws for unknown diagram', async () => {
    await expect(handleAddElement({ diagramId: 'bad', elementType: 'bpmn:Task' })).rejects.toThrow(
      /Diagram not found/
    );
  });

  test('auto-positions after another element', async () => {
    const diagramId = await createDiagram();
    const firstId = await addElement(diagramId, 'bpmn:StartEvent', {
      x: 100,
      y: 100,
    });
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        afterElementId: firstId,
      })
    );
    // The new element should be to the right of the first
    expect(res.position.x).toBeGreaterThan(100);
  });

  test('throws when adding BoundaryEvent without hostElementId', async () => {
    const diagramId = await createDiagram();
    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
      })
    ).rejects.toThrow(/hostElementId/);
  });

  test('attaches BoundaryEvent to a host task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'My Task',
      x: 200,
      y: 200,
    });
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: taskId,
        x: 220,
        y: 260,
      })
    );
    expect(res.success).toBe(true);
    expect(res.elementId).toBeDefined();
  });
});

describe('add_bpmn_element — descriptive element IDs', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('generates a descriptive ID when name is provided', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Enter Name',
      })
    );
    // Prefers short 2-part ID on first use
    expect(res.elementId).toBe('UserTask_EnterName');
  });

  test('generates a descriptive ID for gateways', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Has Surname?',
      })
    );
    // Prefers short 2-part ID on first use
    expect(res.elementId).toBe('Gateway_HasSurname');
  });

  test('generates random ID when no name is provided', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
      })
    );
    // No name → 2-part with random: Task_<random7>
    expect(res.elementId).toMatch(/^Task_[a-z0-9]{7}$/);
  });

  test('generates unique random IDs for unnamed elements', async () => {
    const diagramId = await createDiagram();
    const res1 = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:ServiceTask' })
    );
    const res2 = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:ServiceTask' })
    );
    // Both should have 2-part format with random: ServiceTask_<random7>
    expect(res1.elementId).toMatch(/^ServiceTask_[a-z0-9]{7}$/);
    expect(res2.elementId).toMatch(/^ServiceTask_[a-z0-9]{7}$/);
    expect(res1.elementId).not.toBe(res2.elementId);
  });

  test('falls back to 3-part ID on name collision', async () => {
    const diagramId = await createDiagram();
    const res1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Order',
      })
    );
    const res2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Order',
      })
    );
    // First gets the short 2-part ID
    expect(res1.elementId).toBe('ServiceTask_ProcessOrder');
    // Second collides → 3-part fallback: ServiceTask_<random7>_ProcessOrder
    expect(res2.elementId).toMatch(/^ServiceTask_[a-z0-9]{7}_ProcessOrder$/);
  });
});

describe('add_bpmn_element — smart insertion', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('shifts downstream elements when inserting via afterElementId', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      x: 100,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      x: 300,
      y: 100,
    });

    // Insert a task between start and end
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:Task',
      name: 'Middle Task',
      afterElementId: startId,
    });

    // End event should have been shifted to the right
    const list = parseResult(await handleListElements({ diagramId }));
    const endEl = list.elements.find((e: any) => e.id === endId);
    expect(endEl.x).toBeGreaterThan(300);
  });

  test('should auto-connect when using afterElementId', async () => {
    const diagramId = await createDiagram('autoconnect-test');

    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const addResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Auto Connected',
        afterElementId: startId,
      })
    );
    expect(addResult.success).toBe(true);
    expect(addResult.autoConnected).toBe(true);
    expect(addResult.connectionId).toBeDefined();
  });

  test('should skip auto-connect when autoConnect is false', async () => {
    const diagramId = await createDiagram('no-autoconnect');

    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const addResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'No Connect',
        afterElementId: startId,
        autoConnect: false,
      } as any)
    );
    expect(addResult.success).toBe(true);
    expect(addResult.autoConnected).toBeUndefined();
  });
});
