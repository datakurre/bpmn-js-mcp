/**
 * Test: message flows should have reasonable vertical alignment after layout.
 *
 * When a collaboration has message flows between pools, after layout the
 * connected elements should be reasonably aligned (within a tolerance)
 * at the same X coordinate to reduce diagonal crossings.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleConnect,
  handleLayoutDiagram,
} from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('message flow alignment after layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('paired message events share similar X coordinates after layout', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Sender' }, { name: 'Receiver' }],
      })
    );

    const pool1Id = collab.participantIds[0];
    const pool2Id = collab.participantIds[1];

    // Build a process in pool 1
    const start1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Begin',
        participantId: pool1Id,
      })
    ).elementId;

    const sendTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:SendTask',
        name: 'Send Request',
        participantId: pool1Id,
      })
    ).elementId;

    const end1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done',
        participantId: pool1Id,
      })
    ).elementId;

    await connect(diagramId, start1, sendTask);
    await connect(diagramId, sendTask, end1);

    // Build a process in pool 2
    const start2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Receive Start',
        participantId: pool2Id,
      })
    ).elementId;

    const receiveTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ReceiveTask',
        name: 'Handle Request',
        participantId: pool2Id,
      })
    ).elementId;

    const end2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Handled',
        participantId: pool2Id,
      })
    ).elementId;

    await connect(diagramId, start2, receiveTask);
    await connect(diagramId, receiveTask, end2);

    // Connect message flow between pools
    await handleConnect({
      diagramId,
      sourceElementId: sendTask,
      targetElementId: receiveTask,
    });

    // Run layout
    const layoutResult = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutResult.success).toBe(true);

    // Check that the paired elements have reasonable X alignment
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;

    const sendEl = reg.get(sendTask);
    const receiveEl = reg.get(receiveTask);

    expect(sendEl).toBeDefined();
    expect(receiveEl).toBeDefined();

    // The send/receive elements should be within a reasonable X offset
    // (allowing up to 200px difference given different pool flows)
    const xDiff = Math.abs(sendEl.x - receiveEl.x);
    expect(xDiff).toBeLessThan(200);
  });
});
