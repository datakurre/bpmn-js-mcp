/**
 * Integration test for loop-back patterns in ELK layout.
 *
 * Validates that diagrams containing cycles (loop-back edges) maintain
 * left-to-right directionality for the main path after ELK layout.
 *
 * Covers Root Cause 4: Cycles (Loops) Degrade ELK Layering Quality.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Centre-X of an element. */
function centreX(el: any): number {
  return el.x + (el.width || 0) / 2;
}

/** Assert all waypoints of a connection form strictly orthogonal segments. */
function expectOrthogonal(conn: any) {
  const wps = conn.waypoints;
  expect(wps.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    const isHorizontal = dy < 1;
    const isVertical = dx < 1;
    expect(
      isHorizontal || isVertical,
      `Connection ${conn.id} segment ${i - 1}→${i} is diagonal: ` +
        `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
    ).toBe(true);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Loop-back layout (Root Cause 4)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('simple loop: maintains left-to-right directionality for the main path', async () => {
    // Pattern: Start → Task1 → Gateway → Task2 → End
    //                             ↑                ↓ (loop back: "No" branch)
    //                             └── Retry Task ──┘
    const diagramId = await createDiagram('Simple Loop');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Submit' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, gw);
    await connect(diagramId, gw, task2, { label: 'Yes' });
    await connect(diagramId, task2, end);
    // Loop-back edge: gateway "No" branch goes back to task1
    await connect(diagramId, gw, task1, { label: 'No' });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Main path should flow left-to-right: Start < Task1 < Gateway < Process < End
    const startEl = reg.get(start);
    const task1El = reg.get(task1);
    const gwEl = reg.get(gw);
    const task2El = reg.get(task2);
    const endEl = reg.get(end);

    expect(centreX(startEl)).toBeLessThan(centreX(task1El));
    expect(centreX(task1El)).toBeLessThan(centreX(gwEl));
    expect(centreX(gwEl)).toBeLessThan(centreX(task2El));
    expect(centreX(task2El)).toBeLessThan(centreX(endEl));

    // All connections should be strictly orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });

  test('review loop: approval with retry maintains left-to-right flow', async () => {
    // Pattern: Start → Draft → Review → Approved? → Publish → End
    //                            ↑                     ↓ (loop: "Revise" branch)
    //                            └─── Revise ──────────┘
    const diagramId = await createDiagram('Review Loop');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const draft = await addElement(diagramId, 'bpmn:UserTask', { name: 'Draft' });
    const review = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
    const publish = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Publish' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, draft);
    await connect(diagramId, draft, review);
    await connect(diagramId, review, gw);
    await connect(diagramId, gw, publish, { label: 'Yes' });
    await connect(diagramId, publish, end);
    // Loop-back: Rejected → back to Draft
    await connect(diagramId, gw, draft, { label: 'Revise' });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Main path should flow left-to-right
    const startEl = reg.get(start);
    const draftEl = reg.get(draft);
    const reviewEl = reg.get(review);
    const gwEl = reg.get(gw);
    const publishEl = reg.get(publish);
    const endEl = reg.get(end);

    expect(centreX(startEl)).toBeLessThan(centreX(draftEl));
    expect(centreX(draftEl)).toBeLessThan(centreX(reviewEl));
    expect(centreX(reviewEl)).toBeLessThan(centreX(gwEl));
    expect(centreX(gwEl)).toBeLessThan(centreX(publishEl));
    expect(centreX(publishEl)).toBeLessThan(centreX(endEl));
  });

  test('multi-step loop: iterative processing maintains ordering', async () => {
    // Pattern: Start → Init → Process → Check → End
    //                   ↑                  ↓ (loop back to Init)
    //                   └──────────────────┘
    const diagramId = await createDiagram('Multi-Step Loop');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const init = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Initialize' });
    const process = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Item' });
    const check = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'More items?' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Complete' });

    await connect(diagramId, start, init);
    await connect(diagramId, init, process);
    await connect(diagramId, process, check);
    await connect(diagramId, check, end, { label: 'No' });
    // Loop-back: "Yes" → back to Init for next iteration
    await connect(diagramId, check, init, { label: 'Yes' });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Main forward path should flow left-to-right
    const startEl = reg.get(start);
    const initEl = reg.get(init);
    const processEl = reg.get(process);
    const checkEl = reg.get(check);
    const endEl = reg.get(end);

    expect(centreX(startEl)).toBeLessThan(centreX(initEl));
    expect(centreX(initEl)).toBeLessThan(centreX(processEl));
    expect(centreX(processEl)).toBeLessThan(centreX(checkEl));
    expect(centreX(checkEl)).toBeLessThan(centreX(endEl));

    // All connections should be strictly orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });
});
