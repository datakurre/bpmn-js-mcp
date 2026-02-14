/**
 * Tests for loopback-aware edge routing.
 *
 * Verifies that backward (loopback) connections — where the target is
 * to the left of the source — are routed below the main process path
 * with a clean U-shape rather than cutting through the main flow.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('loopback routing below main path', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('routes gateway loopback below the main flow', async () => {
    // Build: Start → Enter Details → Review → Confirmed? → (Yes) → Generate PDF → End
    //                                          └──── (No, loopback) ────┘
    const diagramId = await createDiagram('Loopback Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const enter = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Details' });
    const review = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Confirmed?' });
    const generate = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Generate PDF' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, enter);
    await connect(diagramId, enter, review);
    await connect(diagramId, review, gw);
    await connect(diagramId, gw, generate, { label: 'Yes' });
    const loopbackFlow = await connect(diagramId, gw, enter, { label: 'No' });
    await connect(diagramId, generate, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const loopConn = reg.get(loopbackFlow);

    expect(loopConn).toBeDefined();
    expect(loopConn.waypoints).toBeDefined();
    expect(loopConn.waypoints.length).toBeGreaterThanOrEqual(4);

    // The loopback should route below the main path.
    // Find the maximum Y of all non-flow elements (the "bottom" of the main path)
    const allShapes = reg.filter(
      (el: any) =>
        !el.type.includes('SequenceFlow') &&
        !el.type.includes('MessageFlow') &&
        el.type !== 'bpmn:Participant' &&
        el.type !== 'bpmn:Lane' &&
        el.type !== 'label' &&
        el.y !== undefined
    );

    const mainPathBottom = Math.max(...allShapes.map((el: any) => (el.y ?? 0) + (el.height ?? 0)));

    // The loopback's maximum Y should be at or below the main path bottom
    const loopMaxY = Math.max(...loopConn.waypoints.map((wp: any) => wp.y));
    expect(
      loopMaxY,
      `Loopback max Y (${loopMaxY}) should be >= main path bottom (${mainPathBottom})`
    ).toBeGreaterThanOrEqual(mainPathBottom);
  });

  test('forward flows are not affected by loopback routing', async () => {
    // Build: Start → T1 → T2 → End (no loopbacks)
    const diagramId = await createDiagram('No Loopback');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const flows = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow' && el.waypoints);

    // All forward flows should have 2 waypoints (straight horizontal)
    for (const flow of flows) {
      expect(
        flow.waypoints.length,
        `Forward flow ${flow.id} should be a simple 2-point route`
      ).toBeLessThanOrEqual(4);
    }
  });

  test('loopback with non-gateway source routes below', async () => {
    // Build: Start → T1 → T2 → T1 (non-gateway loopback)
    const diagramId = await createDiagram('Non-GW Loopback');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Check' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'OK?' });
    const _t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Redo' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, gw);
    await connect(diagramId, gw, end, { label: 'Yes' });
    const loopFlow = await connect(diagramId, gw, t1, { label: 'No' });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const loopConn = reg.get(loopFlow);

    expect(loopConn).toBeDefined();
    expect(loopConn.waypoints).toBeDefined();

    // The loopback should have at least 4 waypoints (U-shape)
    expect(loopConn.waypoints.length).toBeGreaterThanOrEqual(4);
  });
});
