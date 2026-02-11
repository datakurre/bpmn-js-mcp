import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateCollaboration } from '../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../helpers';

describe('handleCreateCollaboration', () => {
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
    ).rejects.toThrow(/At least 2/);
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
});
