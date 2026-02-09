import { describe, it, expect, beforeEach } from 'vitest';
import { handleMoveToLane } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../helpers';

describe('handleMoveToLane', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('rejects moving to a non-lane element', async () => {
    const diagramId = await createDiagram('Non-Lane');
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });

    await expect(handleMoveToLane({ diagramId, elementId: task1, laneId: task2 })).rejects.toThrow(
      /not a Lane/
    );
  });

  it('rejects moving a participant into a lane', async () => {
    const diagramId = await createDiagram('Participant to Lane');
    const part = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 300,
      y: 200,
    });
    const lane = await addElement(diagramId, 'bpmn:Lane', { name: 'Lane 1' });

    await expect(handleMoveToLane({ diagramId, elementId: part, laneId: lane })).rejects.toThrow(
      /Cannot move/
    );
  });

  it('rejects non-existent element', async () => {
    const diagramId = await createDiagram('Missing');

    await expect(
      handleMoveToLane({ diagramId, elementId: 'nonexistent', laneId: 'nonexistent2' })
    ).rejects.toThrow();
  });
});
