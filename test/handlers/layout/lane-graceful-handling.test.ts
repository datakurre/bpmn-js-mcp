import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElement,
  handleLayoutDiagram,
  handleListElements,
} from '../../../src/handlers';
import { handleCreateLanes } from '../../../src/handlers/collaboration/create-lanes';
import { parseResult, clearDiagrams } from '../../helpers';

describe('lane graceful handling', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('layout handles unassigned elements in a pool with lanes', async () => {
    // Create a diagram with a pool
    const createRes = parseResult(await handleCreateDiagram({ name: 'LaneTest' }));
    const diagramId = createRes.diagramId;

    // Add elements to build a simple flow
    const startRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent' })
    );
    const taskRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        name: 'Task A',
        afterElementId: startRes.elementId,
      })
    );
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      afterElementId: taskRes.elementId,
    });

    // Create a participant (pool) to wrap the process
    const { handleWrapProcessInCollaboration } =
      await import('../../../src/handlers/collaboration/wrap-process-in-collaboration');
    await handleWrapProcessInCollaboration({ diagramId, participantName: 'My Pool' });

    // Get the participant ID
    const elementsRes = parseResult(await handleListElements({ diagramId }));
    const participant = elementsRes.elements.find((e: any) => e.type === 'bpmn:Participant');
    expect(participant).toBeDefined();

    // Create lanes - elements are NOT assigned to any lane
    await handleCreateLanes({
      diagramId,
      participantId: participant.id,
      lanes: [{ name: 'Lane 1' }, { name: 'Lane 2' }],
    });

    // Run layout — this should not crash, even though elements are unassigned
    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutRes.success).toBe(true);
  });

  test('layout handles empty lanes gracefully', async () => {
    const createRes = parseResult(await handleCreateDiagram({ name: 'EmptyLanes' }));
    const diagramId = createRes.diagramId;

    const startRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent' })
    );
    const taskRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        name: 'Only Task',
        afterElementId: startRes.elementId,
      })
    );
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      afterElementId: taskRes.elementId,
    });

    const { handleWrapProcessInCollaboration } =
      await import('../../../src/handlers/collaboration/wrap-process-in-collaboration');
    await handleWrapProcessInCollaboration({ diagramId, participantName: 'Pool' });

    const elementsRes = parseResult(await handleListElements({ diagramId }));
    const participant = elementsRes.elements.find((e: any) => e.type === 'bpmn:Participant');

    // Create 3 lanes, only assign elements to one
    await handleCreateLanes({
      diagramId,
      participantId: participant.id,
      lanes: [
        { name: 'Active Lane', elementIds: [startRes.elementId, taskRes.elementId] },
        { name: 'Empty Lane 1' },
        { name: 'Empty Lane 2' },
      ],
    });

    // Layout should succeed without errors
    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutRes.success).toBe(true);
  });
});
