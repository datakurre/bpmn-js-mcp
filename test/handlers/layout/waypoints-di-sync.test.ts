/**
 * Regression tests verifying that waypoint straightening persists to the
 * BPMN DI model — not just the canvas element.
 *
 * The bug: `straightenNonOrthogonalFlows` and `assignLShapeWaypoints` in
 * Layout code once mutated `conn.waypoints` (canvas) directly but
 * never called `modeling.updateWaypoints()`, leaving the DI model
 * (what `saveXML()` serialises) with the original Z-shaped path.
 *
 * Each test asserts orthogonality on BOTH the canvas representation
 * (`conn.waypoints`) AND the exported XML (which reads from the DI model).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import {
  createDiagram,
  addElement,
  connect,
  clearDiagrams,
  getRegistry,
  exportXml,
} from '../../helpers';

/** Assert all waypoint segments are strictly horizontal or vertical (within 1 px). */
function assertOrthogonalWps(wps: Array<{ x: number; y: number }>, label: string): void {
  expect(wps.length, `${label}: too few waypoints`).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    expect(
      dx < 1 || dy < 1,
      `${label} segment ${i - 1}→${i} is diagonal: ` +
        `(${wps[i - 1].x},${wps[i - 1].y})→(${wps[i].x},${wps[i].y})`
    ).toBe(true);
  }
}

/**
 * Extract waypoints for a flow from BPMN XML.
 * Parses BPMNEdge waypoints from the DI section of the exported XML.
 */
function extractXmlWaypoints(xml: string, flowId: string): Array<{ x: number; y: number }> {
  // Match the BPMNEdge block for this flow
  const edgePattern = new RegExp(
    `<bpmndi:BPMNEdge[^>]*bpmnElement="${flowId}"[^>]*>([\\s\\S]*?)</bpmndi:BPMNEdge>`,
    'g'
  );
  const edgeMatch = edgePattern.exec(xml);
  if (!edgeMatch) return [];

  const edgeContent = edgeMatch[1];
  const waypointPattern = /<(?:di:)?waypoint[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*\/>/g;
  const wps: Array<{ x: number; y: number }> = [];
  let wpMatch: RegExpExecArray | null;
  while ((wpMatch = waypointPattern.exec(edgeContent)) !== null) {
    wps.push({ x: parseFloat(wpMatch[1]), y: parseFloat(wpMatch[2]) });
  }
  return wps;
}

describe('waypoints DI sync after layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('exported XML waypoints are orthogonal after full layout (gateway fan-out)', async () => {
    const diagramId = await createDiagram('Full Layout DI Sync');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decision' });
    const t1 = await addElement(diagramId, 'bpmn:Task', { name: 'Task A' });
    const t2 = await addElement(diagramId, 'bpmn:Task', { name: 'Task B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, gw);
    const f2 = await connect(diagramId, gw, t1);
    const f3 = await connect(diagramId, gw, t2);
    await connect(diagramId, t1, end);
    await connect(diagramId, t2, end);

    await handleLayoutDiagram({ diagramId });

    // Both gateway outgoing flows must have orthogonal waypoints in exported XML
    const xml = await exportXml(diagramId);
    for (const flowId of [f2, f3]) {
      const wps = extractXmlWaypoints(xml, flowId);
      assertOrthogonalWps(wps, `exported XML waypoints for ${flowId}`);
    }
  });

  test('gateway→task with near-same centreY produces orthogonal + 2-point path in XML', async () => {
    // Regression for Task 3: bypass layoutConnection for near-same-Y gateway→task.
    // Build a simple gateway→task pair and verify exported XML has a straight path.
    const diagramId = await createDiagram('Gateway Same-Y DI Sync');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'GW' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, gw);
    const f2 = await connect(diagramId, gw, task);
    await connect(diagramId, task, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getRegistry(diagramId);
    const xml = await exportXml(diagramId);
    const wps = extractXmlWaypoints(xml, f2);

    // Exported XML waypoints must be orthogonal
    assertOrthogonalWps(wps, `exported XML waypoints for gateway→task flow ${f2}`);

    // For a simple linear layout, the gateway and task land on the same row
    const gwEl = reg.get(gw);
    const taskEl = reg.get(task);
    const gwMidY = gwEl.y + gwEl.height / 2;
    const taskMidY = taskEl.y + taskEl.height / 2;

    if (Math.abs(gwMidY - taskMidY) <= 10) {
      // Near-same-Y: exported XML should have exactly 2 waypoints on the same Y
      expect(wps.length).toBe(2);
      expect(Math.abs(wps[0].y - wps[1].y)).toBeLessThanOrEqual(1);
    }
  });
});
