import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleCreateCollaboration } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('layout_bpmn_diagram — pool element centering (AP-2)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('elements are vertically centred within a pool', async () => {
    const diagramId = await createDiagram('Pool Centering');

    // Create a collaboration with a pool
    const collabResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Main Process', width: 800, height: 300 },
          { name: 'External System', collapsed: true },
        ],
      })
    );
    const poolId = collabResult.participantIds[0];

    // Add elements inside the pool
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId: poolId,
    });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Process Order',
      participantId: poolId,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      participantId: poolId,
    });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    // Run layout
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Verify elements are approximately centred in the pool
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const pool = reg.get(poolId);
    const startEl = reg.get(start);
    const taskEl = reg.get(task);

    const poolCy = pool.y + pool.height / 2;
    const startCy = startEl.y + (startEl.height || 0) / 2;
    const taskCy = taskEl.y + (taskEl.height || 0) / 2;

    // Elements should be within 40% of the pool's vertical midpoint
    // (accounting for label band at top and padding)
    const tolerance = pool.height * 0.4;
    expect(Math.abs(startCy - poolCy)).toBeLessThan(tolerance);
    expect(Math.abs(taskCy - poolCy)).toBeLessThan(tolerance);
  });
});

describe('layout_bpmn_diagram — pool width scaling (AP-3)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('pool width adjusts to content after layout', async () => {
    const diagramId = await createDiagram('Pool Width');

    const collabResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'My Process', width: 400, height: 250 },
          { name: 'Partner', collapsed: true },
        ],
      })
    );
    const poolId = collabResult.participantIds[0];

    // Add a longer sequence of elements to test width scaling
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId: poolId,
    });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Step 1',
      participantId: poolId,
    });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Step 2',
      participantId: poolId,
    });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Step 3',
      participantId: poolId,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      participantId: poolId,
    });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, t3);
    await connect(diagramId, t3, end);

    // Run layout
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Verify pool width accommodates all elements
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const pool = reg.get(poolId);
    const endEl = reg.get(end);

    // The end event's right edge should be inside the pool with padding
    const endRight = endEl.x + (endEl.width || 0);
    const poolRight = pool.x + pool.width;

    expect(endRight).toBeLessThan(poolRight);
    // Pool should have been resized to fit the content
    expect(pool.width).toBeGreaterThan(400); // Initial was 400, should grow
  });
});
