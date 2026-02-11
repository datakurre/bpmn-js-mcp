/**
 * Tests for happy-path detection at gateways.
 *
 * Verifies that detectHappyPath() follows conditioned (non-default) flows
 * at exclusive/inclusive gateways, not the default (fallback) flow.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleConnect, handleSetProperties, handleLayoutDiagram } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';
import { detectHappyPath } from '../../src/elk/happy-path';

describe('happy-path detection', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('follows conditioned branch (not default) at exclusive gateway', async () => {
    const diagramId = await createDiagram('Happy Path Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
    const taskYes = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
    const taskNo = await addElement(diagramId, 'bpmn:UserTask', { name: 'Reject' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    // Connect: Start → Gateway
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });

    // Gateway → Process (conditioned/Yes path)
    const connYes = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskYes,
        conditionExpression: '${valid}',
      })
    );

    // Gateway → Reject (default/No path — fallback)
    const connNo = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskNo,
      })
    );

    // Process → End
    await handleConnect({ diagramId, sourceElementId: taskYes, targetElementId: end });

    // Set default flow to the No/Reject path (the fallback)
    await handleSetProperties({
      diagramId,
      elementId: gw,
      properties: { default: connNo.connectionId },
    });

    // Detect happy path
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const allElements = reg.getAll();
    const happyEdges = detectHappyPath(allElements);

    // The happy path should follow the conditioned Yes branch, NOT the default No branch
    expect(happyEdges.has(connYes.connectionId)).toBe(true);
    expect(happyEdges.has(connNo.connectionId)).toBe(false);
  });

  test('follows first outgoing when no default is set', async () => {
    const diagramId = await createDiagram('No Default Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Split' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path B' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });

    const connA = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskA,
      })
    );

    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: taskB,
    });

    // No default set — should follow first outgoing
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const allElements = reg.getAll();
    const happyEdges = detectHappyPath(allElements);

    expect(happyEdges.has(connA.connectionId)).toBe(true);
  });

  test('parallel gateway follows first outgoing (no default concept)', async () => {
    const diagramId = await createDiagram('Parallel Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Fork' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch A' });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });

    const connA = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskA,
      })
    );

    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: taskB,
    });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const allElements = reg.getAll();
    const happyEdges = detectHappyPath(allElements);

    // Should follow first outgoing connection
    expect(happyEdges.has(connA.connectionId)).toBe(true);
  });

  test('layout uses corrected happy-path for exclusive gateway with default', async () => {
    // Build a diagram where the default flow is the error path
    const diagramId = await createDiagram('Layout Happy Path');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Submit' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
    const taskOk = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Order' });
    const taskErr = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle Error' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task1 });
    await handleConnect({ diagramId, sourceElementId: task1, targetElementId: gw });

    // Ok path (conditioned)
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: taskOk,
      conditionExpression: '${valid}',
    });

    // Error path (default = fallback)
    const connErr = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: taskErr,
      })
    );

    await handleConnect({ diagramId, sourceElementId: taskOk, targetElementId: end });

    // Set default to the error path
    await handleSetProperties({
      diagramId,
      elementId: gw,
      properties: { default: connErr.connectionId },
    });

    // Run layout
    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Happy path elements (Start, Submit, Valid?, Process Order, Done)
    // should all be roughly on the same Y row
    const startEl = reg.get(start);
    const taskOkEl = reg.get(taskOk);
    const endEl = reg.get(end);
    const taskErrEl = reg.get(taskErr);

    const startCy = startEl.y + (startEl.height || 0) / 2;
    const okCy = taskOkEl.y + (taskOkEl.height || 0) / 2;
    const endCy = endEl.y + (endEl.height || 0) / 2;
    const errCy = taskErrEl.y + (taskErrEl.height || 0) / 2;

    // Handle Error (off-path) should NOT be between Start and Process Order
    // on the Y-axis.  It should be distinctly above or below the happy path.
    // This verifies that the layout doesn't treat the default/error branch
    // as the main path.
    const happyPathAvgCy = (startCy + okCy + endCy) / 3;
    expect(
      Math.abs(errCy - happyPathAvgCy),
      'Error task should be on a different row from happy path'
    ).toBeGreaterThan(20);
  });
});
