import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, getRegistry } from '../../helpers';

describe('add_bpmn_element placement and collision controls', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('placementStrategy "absolute" disables collision avoidance', async () => {
    const diagramId = await createDiagram();
    // Add first element at a specific position
    await addElement(diagramId, 'bpmn:Task', { name: 'First', x: 100, y: 100 });

    // Add second element at exact same position with "absolute" strategy
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        name: 'Second',
        x: 100,
        y: 100,
        placementStrategy: 'absolute',
      })
    );
    expect(res.success).toBe(true);
    // With absolute, the element should be at the exact requested position
    expect(res.position.x).toBe(100);
    expect(res.position.y).toBe(100);
  });

  test('collisionPolicy "none" allows overlapping elements', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Task', { name: 'First' });

    // Add second element with collision avoidance disabled
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        name: 'Second',
        collisionPolicy: 'none',
      })
    );
    expect(res.success).toBe(true);
  });

  test('placementStrategy "after" requires afterElementId', async () => {
    const diagramId = await createDiagram();
    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        placementStrategy: 'after',
      })
    ).rejects.toThrow(/afterElementId/);
  });

  test('placementStrategy "insert" requires flowId', async () => {
    const diagramId = await createDiagram();
    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        placementStrategy: 'insert',
      })
    ).rejects.toThrow(/flowId/);
  });

  test('default collisionPolicy "shift" avoids overlaps', async () => {
    const diagramId = await createDiagram();
    // Add element at default position
    const firstId = await addElement(diagramId, 'bpmn:Task', { name: 'First' });

    // Add another element at default position (should auto-shift)
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        name: 'Second',
      })
    );
    expect(res.success).toBe(true);

    // Second element should not overlap with first
    const registry = getRegistry(diagramId);
    const first = registry.get(firstId);
    const second = registry.get(res.elementId);
    // second should be shifted away from first
    const firstRight = first.x + (first.width || 100);
    expect(second.x).toBeGreaterThanOrEqual(firstRight);
  });
});
