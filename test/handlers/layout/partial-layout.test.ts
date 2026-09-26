/**
 * Partial layout with bpmn-auto-layout: `elementIds` subsets, `scopeElementId`
 * scopes, and undo of a whole layout in one step.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleBpmnHistory } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

function registry(diagramId: string): any {
  return getDiagram(diagramId)!.modeler.get('elementRegistry');
}

function modeling(diagramId: string): any {
  return getDiagram(diagramId)!.modeler.get('modeling');
}

function snapshot(diagramId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of registry(diagramId).getAll()) {
    if (el.waypoints) out[el.id] = el.waypoints.map((p: any) => `${p.x},${p.y}`).join(' ');
    else if (el.x !== undefined) out[el.id] = `${el.x},${el.y},${el.width},${el.height}`;
  }
  return out;
}

async function buildLinearWithBranch() {
  const diagramId = await createDiagram('Partial Layout');
  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
  const review = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
  const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'OK?' });
  const publish = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Publish' });
  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
  await connect(diagramId, start, review);
  await connect(diagramId, review, gw);
  await connect(diagramId, gw, publish, { label: 'yes' });
  await connect(diagramId, publish, end);
  const noFlow = await connect(diagramId, gw, end, { label: 'no' });
  return { diagramId, start, review, gw, publish, end, noFlow };
}

describe('partial layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('full layout is undone in a single history step', async () => {
    const ids = await buildLinearWithBranch();
    const before = snapshot(ids.diagramId);

    parseResult(await handleLayoutDiagram({ diagramId: ids.diagramId }));
    expect(snapshot(ids.diagramId)).not.toEqual(before);

    parseResult(await handleBpmnHistory({ diagramId: ids.diagramId, action: 'undo' }));
    expect(snapshot(ids.diagramId)).toEqual(before);
  });

  test('elementIds re-lays out only the subset, anchored at its top-left', async () => {
    const ids = await buildLinearWithBranch();
    await handleLayoutDiagram({ diagramId: ids.diagramId });
    const laidOut = snapshot(ids.diagramId);

    // Disturb two elements of the middle section
    const reg = registry(ids.diagramId);
    modeling(ids.diagramId).moveShape(reg.get(ids.gw), { x: 40, y: 200 });
    modeling(ids.diagramId).moveShape(reg.get(ids.publish), { x: -60, y: 120 });

    const res = parseResult(
      await handleLayoutDiagram({
        diagramId: ids.diagramId,
        elementIds: [ids.review, ids.gw, ids.publish],
      })
    );
    expect(res.success).toBe(true);
    expect(res.scopeNote).toBeDefined();

    const after = snapshot(ids.diagramId);
    // Elements outside the subset are untouched
    expect(after[ids.start]).toBe(laidOut[ids.start]);
    expect(after[ids.end]).toBe(laidOut[ids.end]);
    // The subset is restored to its laid-out arrangement (Review was not
    // moved, so the subset's top-left anchor is unchanged)
    expect(after[ids.review]).toBe(laidOut[ids.review]);
    expect(after[ids.gw]).toBe(laidOut[ids.gw]);
    expect(after[ids.publish]).toBe(laidOut[ids.publish]);

    // The flow crossing the subset boundary was re-routed from the gateway
    const gwEl = registry(ids.diagramId).get(ids.gw);
    const first = registry(ids.diagramId).get(ids.noFlow).waypoints[0];
    expect(first.x).toBeGreaterThanOrEqual(gwEl.x - 1);
    expect(first.x).toBeLessThanOrEqual(gwEl.x + gwEl.width + 1);
    expect(first.y).toBeGreaterThanOrEqual(gwEl.y - 1);
    expect(first.y).toBeLessThanOrEqual(gwEl.y + gwEl.height + 1);
  });

  test('elementIds and scopeElementId are mutually exclusive', async () => {
    const ids = await buildLinearWithBranch();
    await expect(
      handleLayoutDiagram({
        diagramId: ids.diagramId,
        elementIds: [ids.review],
        scopeElementId: 'Process_1',
      })
    ).rejects.toThrow(/either scopeElementId or elementIds/);
  });

  test('elementIds must exist', async () => {
    const ids = await buildLinearWithBranch();
    await expect(
      handleLayoutDiagram({ diagramId: ids.diagramId, elementIds: [ids.review, 'Nope_1'] })
    ).rejects.toThrow(/Nope_1/);
  });

  test('scopeElementId lays out a subprocess in place', async () => {
    const diagramId = await createDiagram('Scoped Layout');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const sub = await addElement(diagramId, 'bpmn:SubProcess', { name: 'Handle' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
    await connect(diagramId, start, sub);
    await connect(diagramId, sub, end);
    const inner1 = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'In',
      parentId: sub,
    });
    const inner2 = await addElement(diagramId, 'bpmn:Task', { name: 'Work', parentId: sub });
    await connect(diagramId, inner1, inner2);

    const reg = registry(diagramId);
    const subBefore = { x: reg.get(sub).x, y: reg.get(sub).y };
    const startBefore = snapshot(diagramId)[start];

    const res = parseResult(await handleLayoutDiagram({ diagramId, scopeElementId: sub }));
    expect(res.success).toBe(true);

    const subEl = reg.get(sub);
    // The scope keeps its top-left corner, and the rest is untouched
    expect({ x: subEl.x, y: subEl.y }).toEqual(subBefore);
    expect(snapshot(diagramId)[start]).toBe(startBefore);
    // Its children are laid out left-to-right inside it
    const a = reg.get(inner1);
    const b = reg.get(inner2);
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    for (const el of [a, b]) {
      expect(el.x).toBeGreaterThanOrEqual(subEl.x);
      expect(el.y).toBeGreaterThanOrEqual(subEl.y);
      expect(el.x + el.width).toBeLessThanOrEqual(subEl.x + subEl.width);
      expect(el.y + el.height).toBeLessThanOrEqual(subEl.y + subEl.height);
    }
  });
});
