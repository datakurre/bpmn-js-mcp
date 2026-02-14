import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateCollaboration, handleAddElement } from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('create_bpmn_collaboration', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates a collaboration with two participants', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Customer' }, { name: 'Supplier' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.participantCount).toBe(2);
    expect(res.participantIds).toHaveLength(2);
  });

  test('creates participants with custom process IDs', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Buyer', processId: 'Process_Buyer' },
          { name: 'Seller', processId: 'Process_Seller' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.participantCount).toBe(2);
  });

  test('rejects fewer than 2 participants', async () => {
    const diagramId = await createDiagram();

    await expect(
      handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Solo' }],
      })
    ).rejects.toThrow(/Missing required/);
  });

  test('generates descriptive IDs for participants', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Order Service' }, { name: 'Payment Service' }],
      })
    );

    expect(res.participantIds[0]).toContain('Participant');
    expect(res.participantIds[1]).toContain('Participant');
  });

  test('creates lanes within a participant when lanes are specified', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          {
            name: 'HR Department',
            lanes: [{ name: 'Recruiter' }, { name: 'Hiring Manager' }],
          },
          { name: 'Candidate', collapsed: true },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.participantCount).toBe(2);
    expect(res.lanesCreated).toBeDefined();
    const hrParticipantId = res.participantIds[0];
    expect(res.lanesCreated[hrParticipantId]).toHaveLength(2);
  });

  test('ignores lanes on collapsed participants', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Main Process' },
          {
            name: 'External System',
            collapsed: true,
            lanes: [{ name: 'Should Be Ignored' }, { name: 'Also Ignored' }],
          },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.lanesCreated).toBeUndefined();
  });

  test('all expanded participants have processRef for element association', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Pool A' }, { name: 'Pool B' }, { name: 'Pool C' }],
      })
    );

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;

    // Every expanded pool should have a processRef
    for (const pId of collab.participantIds) {
      const participant = reg.get(pId);
      expect(participant.businessObject.processRef).toBeDefined();
      expect(participant.businessObject.processRef.id).toBeTruthy();
    }

    // Elements added to each pool should end up in that pool's process
    for (const pId of collab.participantIds) {
      const task = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:UserTask',
          name: `Task in ${pId}`,
          participantId: pId,
        })
      );
      expect(task.elementId).toBeTruthy();
    }

    // Verify flowElements are in the correct processes
    for (const pId of collab.participantIds) {
      const participant = reg.get(pId);
      const process = participant.businessObject.processRef;
      expect(process.flowElements?.length).toBeGreaterThanOrEqual(1);
    }
  });
});
