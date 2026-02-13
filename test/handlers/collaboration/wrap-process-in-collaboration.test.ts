import { describe, test, expect, beforeEach } from 'vitest';
import { handleWrapProcessInCollaboration } from '../../../src/handlers';
import {
  createDiagram,
  addElement,
  connect,
  parseResult,
  clearDiagrams,
  exportXml,
} from '../../helpers';

describe('wrap_bpmn_process_in_collaboration', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('wraps an existing process in a participant', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Work' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const res = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'My Organization',
      })
    );

    expect(res.success).toBe(true);
    expect(res.participantIds).toHaveLength(1);
    expect(res.mainParticipantId).toBeTruthy();
    expect(res.existingElementCount).toBe(3);

    // Verify elements still exist in the diagram
    const xml = await exportXml(diagramId);
    expect(xml).toContain('Do Work');
    expect(xml).toContain('My Organization');
    expect(xml).toContain('bpmn:collaboration');
  });

  test('wraps with additional collapsed partner pools', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    const res = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'Main Process',
        additionalParticipants: [
          { name: 'External System', collapsed: true },
          { name: 'Partner', collapsed: true },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.participantIds).toHaveLength(3);
  });

  test('rejects diagram that already has participants', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:Participant', { name: 'Existing Pool', x: 300, y: 200 });

    await expect(
      handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'New Pool',
      })
    ).rejects.toThrow(/already contains participants/);
  });

  test('works with empty process', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'Empty Process Pool',
      })
    );

    expect(res.success).toBe(true);
    expect(res.existingElementCount).toBe(0);
  });
});
