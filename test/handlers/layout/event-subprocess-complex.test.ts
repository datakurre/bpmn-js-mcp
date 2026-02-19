/**
 * Tests for event subprocess layout with complex content (I6).
 *
 * Verifies that event subprocesses containing gateways, parallel branches,
 * and intermediate events are laid out correctly — the subprocess is
 * positioned below the main process, its internal elements form a valid
 * left-to-right flow, and the parent process is not disrupted.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement, handleLayoutDiagram, handleSetProperties } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('event subprocess layout — complex content (I6)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('event subprocess with parallel gateway branches is laid out correctly', async () => {
    // Main process: Start → Task → End
    const diagramId = await createDiagram('Event Subprocess Complex');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const mainTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Work' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, mainTask);
    await connect(diagramId, mainTask, end);

    // Create event subprocess (triggered by event)
    const evtSubResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:SubProcess',
        name: 'Error Handler',
        x: 200,
        y: 400,
      })
    );
    const evtSubId = evtSubResult.elementId as string;
    await handleSetProperties({
      diagramId,
      elementId: evtSubId,
      properties: { triggeredByEvent: true, isExpanded: true },
    });

    // Add elements inside the event subprocess
    const subStart = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Error Caught',
        parentId: evtSubId,
        x: 250,
        y: 450,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        errorRef: { id: 'Error_1', name: 'ServiceError', errorCode: 'ERR_001' },
      })
    ).elementId as string;

    const split = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ParallelGateway',
        name: 'Split',
        parentId: evtSubId,
        x: 330,
        y: 452,
      })
    ).elementId as string;

    const branchA = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Log Error',
        parentId: evtSubId,
        x: 430,
        y: 410,
      })
    ).elementId as string;

    const branchB = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Notify Admin',
        parentId: evtSubId,
        x: 430,
        y: 500,
      })
    ).elementId as string;

    const join = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ParallelGateway',
        name: 'Join',
        parentId: evtSubId,
        x: 550,
        y: 452,
      })
    ).elementId as string;

    const subEnd = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Handler Done',
        parentId: evtSubId,
        x: 640,
        y: 460,
      })
    ).elementId as string;

    // Connect internal flow
    await connect(diagramId, subStart, split);
    await connect(diagramId, split, branchA);
    await connect(diagramId, split, branchB);
    await connect(diagramId, branchA, join);
    await connect(diagramId, branchB, join);
    await connect(diagramId, join, subEnd);

    // Run layout — should succeed without errors
    const layoutResult = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutResult.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Main process elements should have positive X coordinates
    const startEl = reg.get(start);
    const mainTaskEl = reg.get(mainTask);
    const endEl = reg.get(end);
    expect(startEl.x).toBeGreaterThan(0);
    expect(mainTaskEl.x).toBeGreaterThan(startEl.x);
    expect(endEl.x).toBeGreaterThan(mainTaskEl.x);

    // Event subprocess should be positioned (not at 0,0)
    const evtSubEl = reg.get(evtSubId);
    expect(evtSubEl).toBeDefined();
    expect(evtSubEl.x).toBeGreaterThan(0);

    // The event subprocess should be below the main process elements
    // (event subprocesses are positioned below the main process)
    const mainRowY = mainTaskEl.y + (mainTaskEl.height || 80) / 2;
    const evtSubBottom = evtSubEl.y + (evtSubEl.height || 200);
    expect(evtSubEl.y).toBeGreaterThan(0);
    expect(evtSubBottom).toBeGreaterThan(mainRowY);

    // Internal elements should have valid positions within the subprocess
    const splitEl = reg.get(split);
    const joinEl = reg.get(join);
    const branchAEl = reg.get(branchA);
    const branchBEl = reg.get(branchB);

    expect(splitEl).toBeDefined();
    expect(joinEl).toBeDefined();
    expect(branchAEl).toBeDefined();
    expect(branchBEl).toBeDefined();

    // Internal left-to-right ordering (split before join on X axis)
    expect(splitEl.x).toBeLessThan(joinEl.x);

    // Branches should be between split and join
    expect(branchAEl.x).toBeGreaterThanOrEqual(splitEl.x);
    expect(branchBEl.x).toBeGreaterThanOrEqual(splitEl.x);
  });

  test('event subprocess with sequential chain lays out in order', async () => {
    // Main process
    const diagramId = await createDiagram('Event Subprocess Sequential');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const mainTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, mainTask);
    await connect(diagramId, mainTask, end);

    // Create event subprocess
    const evtSubResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:SubProcess',
        name: 'Timeout Handler',
        x: 200,
        y: 350,
      })
    );
    const evtSubId = evtSubResult.elementId as string;
    await handleSetProperties({
      diagramId,
      elementId: evtSubId,
      properties: { triggeredByEvent: true, isExpanded: true },
    });

    // Build internal sequential chain: Timer Start → Task → Gateway → Task → End
    const timerStart = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Timeout',
        parentId: evtSubId,
        x: 250,
        y: 400,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT1H' },
      })
    ).elementId as string;

    const cancelTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Cancel Request',
        parentId: evtSubId,
        x: 340,
        y: 390,
      })
    ).elementId as string;

    const gw = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Retry?',
        parentId: evtSubId,
        x: 460,
        y: 402,
      })
    ).elementId as string;

    const notifyTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Notify User',
        parentId: evtSubId,
        x: 560,
        y: 390,
      })
    ).elementId as string;

    const subEnd = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Timeout Handled',
        parentId: evtSubId,
        x: 680,
        y: 400,
      })
    ).elementId as string;

    await connect(diagramId, timerStart, cancelTask);
    await connect(diagramId, cancelTask, gw);
    await connect(diagramId, gw, notifyTask);
    await connect(diagramId, notifyTask, subEnd);

    // Layout
    const layoutResult = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutResult.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const timerStartEl = reg.get(timerStart);
    const cancelTaskEl = reg.get(cancelTask);
    const gwEl = reg.get(gw);
    const notifyTaskEl = reg.get(notifyTask);
    const subEndEl = reg.get(subEnd);

    // Internal elements should be in left-to-right order
    expect(timerStartEl.x).toBeLessThan(cancelTaskEl.x);
    expect(cancelTaskEl.x).toBeLessThan(gwEl.x);
    expect(gwEl.x).toBeLessThan(notifyTaskEl.x);
    expect(notifyTaskEl.x).toBeLessThan(subEndEl.x);
  });

  test('multiple event subprocesses are each positioned below main process', async () => {
    // Main process
    const diagramId = await createDiagram('Multiple Event Subprocesses');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const mainTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, mainTask);
    await connect(diagramId, mainTask, end);

    // Create first event subprocess (timer)
    const evtSub1Result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:SubProcess',
        name: 'Timer Handler',
        x: 200,
        y: 350,
      })
    );
    const evtSub1Id = evtSub1Result.elementId as string;
    await handleSetProperties({
      diagramId,
      elementId: evtSub1Id,
      properties: { triggeredByEvent: true, isExpanded: true },
    });
    const timerStart = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Timer',
        parentId: evtSub1Id,
        x: 250,
        y: 400,
      })
    ).elementId as string;
    const timerTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Handle Timeout',
        parentId: evtSub1Id,
        x: 340,
        y: 390,
      })
    ).elementId as string;
    const timerEnd = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done',
        parentId: evtSub1Id,
        x: 460,
        y: 400,
      })
    ).elementId as string;
    await connect(diagramId, timerStart, timerTask);
    await connect(diagramId, timerTask, timerEnd);

    // Create second event subprocess (error)
    const evtSub2Result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:SubProcess',
        name: 'Error Handler',
        x: 200,
        y: 550,
      })
    );
    const evtSub2Id = evtSub2Result.elementId as string;
    await handleSetProperties({
      diagramId,
      elementId: evtSub2Id,
      properties: { triggeredByEvent: true, isExpanded: true },
    });
    const errorStart = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Error',
        parentId: evtSub2Id,
        x: 250,
        y: 600,
      })
    ).elementId as string;
    const errorTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Handle Error',
        parentId: evtSub2Id,
        x: 340,
        y: 590,
      })
    ).elementId as string;
    const errorEnd = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Error Handled',
        parentId: evtSub2Id,
        x: 460,
        y: 600,
      })
    ).elementId as string;
    await connect(diagramId, errorStart, errorTask);
    await connect(diagramId, errorTask, errorEnd);

    // Layout
    const layoutResult = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutResult.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Both event subprocesses should be positioned below the main process
    const mainTaskEl = reg.get(mainTask);
    const mainRowBottom = mainTaskEl.y + (mainTaskEl.height || 80);

    const evtSub1El = reg.get(evtSub1Id);
    const evtSub2El = reg.get(evtSub2Id);

    expect(evtSub1El).toBeDefined();
    expect(evtSub2El).toBeDefined();

    // Both event subprocesses should start below the main task row
    expect(evtSub1El.y).toBeGreaterThan(mainRowBottom - 20);
    expect(evtSub2El.y).toBeGreaterThan(mainRowBottom - 20);

    // G3: Multiple event subprocesses are now arranged horizontally side-by-side
    // so they share roughly the same Y baseline. Verify they do not overlap.
    const evtSub1Right = evtSub1El.x + (evtSub1El.width || 0);
    const evtSub1Bottom = evtSub1El.y + (evtSub1El.height || 200);
    const evtSub2Right = evtSub2El.x + (evtSub2El.width || 0);
    const evtSub2Bottom = evtSub2El.y + (evtSub2El.height || 200);
    // Non-overlapping: separated horizontally OR vertically
    const noOverlapHoriz = evtSub1Right <= evtSub2El.x + 20 || evtSub2Right <= evtSub1El.x + 20;
    const noOverlapVert = evtSub1Bottom <= evtSub2El.y + 20 || evtSub2Bottom <= evtSub1El.y + 20;
    expect(noOverlapHoriz || noOverlapVert, 'Event subprocesses should not heavily overlap').toBe(
      true
    );
  });

  test('G3: two event subprocesses are arranged side-by-side horizontally', async () => {
    // Main process
    const diagramId = await createDiagram('G3 Horizontal Event Subprocesses');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const mainTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, mainTask);
    await connect(diagramId, mainTask, end);

    const { handleAddElement: hAE, handleSetProperties: hSP } =
      await import('../../../src/handlers');

    // Helper to create a minimal event subprocess (Start → Task → End)
    async function makeEventSub(name: string, x: number, y: number) {
      const subResult = parseResult(
        await hAE({ diagramId, elementType: 'bpmn:SubProcess', name, x, y })
      );
      const subId = subResult.elementId as string;
      await hSP({
        diagramId,
        elementId: subId,
        properties: { triggeredByEvent: true, isExpanded: true },
      });
      const s = parseResult(
        await hAE({
          diagramId,
          elementType: 'bpmn:StartEvent',
          name: 'S',
          parentId: subId,
          x: x + 30,
          y: y + 30,
        })
      ).elementId as string;
      const t = parseResult(
        await hAE({
          diagramId,
          elementType: 'bpmn:ServiceTask',
          name: 'T',
          parentId: subId,
          x: x + 120,
          y: y + 20,
        })
      ).elementId as string;
      const e = parseResult(
        await hAE({
          diagramId,
          elementType: 'bpmn:EndEvent',
          name: 'E',
          parentId: subId,
          x: x + 230,
          y: y + 30,
        })
      ).elementId as string;
      await connect(diagramId, s, t);
      await connect(diagramId, t, e);
      return subId;
    }

    const sub1Id = await makeEventSub('Timer Handler', 200, 350);
    const sub2Id = await makeEventSub('Error Handler', 200, 550);

    const layoutResult = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutResult.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const sub1El = reg.get(sub1Id);
    const sub2El = reg.get(sub2Id);
    const mainTaskEl = reg.get(mainTask);

    expect(sub1El).toBeDefined();
    expect(sub2El).toBeDefined();

    // Both should be below the main process
    const mainBottom = mainTaskEl.y + (mainTaskEl.height || 80);
    expect(sub1El.y).toBeGreaterThan(mainBottom - 20);
    expect(sub2El.y).toBeGreaterThan(mainBottom - 20);

    // G3: The two subprocesses should be at roughly the same Y (horizontal arrangement).
    // Allow up to 50px Y difference to tolerate minor rounding.
    const yDiff = Math.abs(sub1El.y - sub2El.y);
    expect(yDiff).toBeLessThan(50);

    // They should be separated horizontally (non-overlapping side by side)
    const sub1Right = sub1El.x + (sub1El.width || 0);
    const sub2Right = sub2El.x + (sub2El.width || 0);
    const horizontallyAdjacentOrSeparated =
      sub1Right <= sub2El.x + 20 || sub2Right <= sub1El.x + 20;
    expect(
      horizontallyAdjacentOrSeparated,
      'Event subprocesses should be side-by-side, not overlapping'
    ).toBe(true);
  });
});
