/**
 * Test: collaboration with both pools executable should warn about lane alternative.
 *
 * When both pools in a collaboration have real tasks (i.e. both are "executable"),
 * the suggest_bpmn_pool_vs_lanes tool should recommend converting to lanes.
 * This is a key scenario because Camunda 7 only supports one executable pool.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleConnect,
  handleSuggestPoolVsLanes,
} from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('suggest_bpmn_pool_vs_lanes – executable pools', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when both expanded pools have real tasks', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Customer' }, { name: 'Helpdesk' }],
      })
    );

    const pool1Id = collab.participantIds[0];
    const pool2Id = collab.participantIds[1];

    // Add tasks to both pools – both are "executable" / have real work
    const start1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Request Received',
        participantId: pool1Id,
      })
    ).elementId;

    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Submit Request',
        participantId: pool1Id,
      })
    ).elementId;

    const end1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Request Sent',
        participantId: pool1Id,
      })
    ).elementId;

    await handleConnect({
      diagramId,
      sourceElementId: start1,
      targetElementId: task1,
    });
    await handleConnect({
      diagramId,
      sourceElementId: task1,
      targetElementId: end1,
    });

    const start2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Ticket Created',
        participantId: pool2Id,
      })
    ).elementId;

    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Ticket',
        participantId: pool2Id,
      })
    ).elementId;

    const end2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Ticket Resolved',
        participantId: pool2Id,
      })
    ).elementId;

    await handleConnect({
      diagramId,
      sourceElementId: start2,
      targetElementId: task2,
    });
    await handleConnect({
      diagramId,
      sourceElementId: task2,
      targetElementId: end2,
    });

    const result = parseResult(await handleSuggestPoolVsLanes({ diagramId }));

    // Both pools have real tasks → should recommend lanes
    expect(result.recommendation).toBe('lanes');
    expect(result.confidence).not.toBe('low');

    // Should indicate same-organization pattern
    expect(result.indicators.sameOrganization.length).toBeGreaterThan(0);

    // Participant analysis should show both pools have real tasks
    expect(result.participantAnalysis).toHaveLength(2);
    for (const p of result.participantAnalysis) {
      expect(p.hasRealTasks).toBe(true);
      expect(p.taskCount).toBeGreaterThan(0);
    }

    // The "all expanded pools have real tasks" indicator should be present
    const allTasksIndicator = result.indicators.sameOrganization.find((s: string) =>
      s.includes('All expanded pools have real tasks')
    );
    expect(allTasksIndicator).toBeDefined();

    // Suggestion should mention converting to lanes
    expect(result.suggestion).toMatch(/convert.*lanes/i);
  });

  test('does not warn when one pool has no tasks (external system)', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Order Service' }, { name: 'Payment Gateway' }],
      })
    );

    const pool1Id = collab.participantIds[0];
    // pool2 is left empty – represents an external system

    const start = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Order Placed',
        participantId: pool1Id,
      })
    ).elementId;

    const task = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Payment',
        participantId: pool1Id,
      })
    ).elementId;

    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Payment Done',
        participantId: pool1Id,
      })
    ).elementId;

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });

    const result = parseResult(await handleSuggestPoolVsLanes({ diagramId }));

    // One pool is empty + system-like names → collaboration is appropriate
    expect(result.indicators.separateOrganization.length).toBeGreaterThan(0);

    // The "all pools have real tasks" indicator should NOT be present
    const allTasksIndicator = result.indicators.sameOrganization.find((s: string) =>
      s.includes('All expanded pools have real tasks')
    );
    expect(allTasksIndicator).toBeUndefined();
  });
});
