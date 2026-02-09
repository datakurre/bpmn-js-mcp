/**
 * SVG snapshot generation for visual regression.
 *
 * Builds representative BPMN diagrams, runs ELK layout, and exports
 * SVGs to `test/fixtures/layout-snapshots/`. These serve as visual
 * regression baselines — reviewers can open them in a browser to see
 * the actual diagram appearance.
 *
 * Run with: npx vitest run test/handlers/svg-snapshots.test.ts
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  handleLayoutDiagram,
  handleConnect,
  handleCreateCollaboration,
  handleExportBpmn,
  handleAddElement,
} from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

const SNAPSHOT_DIR = join(__dirname, '..', 'fixtures', 'layout-snapshots');

function ensureDir() {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

async function exportSvg(diagramId: string): Promise<string> {
  const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
  const text = res.content[0].text;
  return text;
}

function writeSvg(name: string, svg: string) {
  ensureDir();
  writeFileSync(join(SNAPSHOT_DIR, `${name}.svg`), svg);
}

// ── Test fixtures ──────────────────────────────────────────────────────────

describe('SVG snapshot generation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  afterAll(() => {
    clearDiagrams();
  });

  it('linear flow', async () => {
    const diagramId = await createDiagram('Linear Flow');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Order Received' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Validate Order' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Payment' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Ship Order' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Order Complete' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: t1 });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: t2 });
    await handleConnect({ diagramId, sourceElementId: t2, targetElementId: t3 });
    await handleConnect({ diagramId, sourceElementId: t3, targetElementId: end });

    await handleLayoutDiagram({ diagramId });
    const svg = await exportSvg(diagramId);
    expect(svg).toContain('<svg');
    writeSvg('01-linear-flow', svg);
  });

  it('exclusive gateway split-join', async () => {
    const diagramId = await createDiagram('Exclusive Gateway');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Request Received' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
    const yes = await addElement(diagramId, 'bpmn:UserTask', { name: 'Fulfill Request' });
    const no = await addElement(diagramId, 'bpmn:UserTask', { name: 'Send Rejection' });
    const merge = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: yes,
      label: 'Yes',
    });
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: no,
      label: 'No',
    });
    await handleConnect({ diagramId, sourceElementId: yes, targetElementId: merge });
    await handleConnect({ diagramId, sourceElementId: no, targetElementId: merge });
    await handleConnect({ diagramId, sourceElementId: merge, targetElementId: end });

    await handleLayoutDiagram({ diagramId });
    const svg = await exportSvg(diagramId);
    expect(svg).toContain('<svg');
    writeSvg('02-exclusive-gateway', svg);
  });

  it('parallel fork-join', async () => {
    const diagramId = await createDiagram('Parallel Fork-Join');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway');
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Check Inventory' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Charge Payment' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Notify Warehouse' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway');
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Complete' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: split });
    await handleConnect({ diagramId, sourceElementId: split, targetElementId: t1 });
    await handleConnect({ diagramId, sourceElementId: split, targetElementId: t2 });
    await handleConnect({ diagramId, sourceElementId: split, targetElementId: t3 });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: t2, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: t3, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: join, targetElementId: end });

    await handleLayoutDiagram({ diagramId });
    const svg = await exportSvg(diagramId);
    expect(svg).toContain('<svg');
    writeSvg('03-parallel-fork-join', svg);
  });

  it('nested subprocess', async () => {
    const diagramId = await createDiagram('Nested SubProcess');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const sub = await addElement(diagramId, 'bpmn:SubProcess', { name: 'Review Process' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const subStart = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Sub Start',
        participantId: sub,
      })
    ).elementId;
    const subTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Document',
        participantId: sub,
      })
    ).elementId;
    const subEnd = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Sub End',
        participantId: sub,
      })
    ).elementId;

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: sub });
    await handleConnect({ diagramId, sourceElementId: sub, targetElementId: end });
    await handleConnect({ diagramId, sourceElementId: subStart, targetElementId: subTask });
    await handleConnect({ diagramId, sourceElementId: subTask, targetElementId: subEnd });

    await handleLayoutDiagram({ diagramId });
    const svg = await exportSvg(diagramId);
    expect(svg).toContain('<svg');
    writeSvg('04-nested-subprocess', svg);
  });

  it('collaboration with two pools', async () => {
    const diagramId = await createDiagram('Collaboration');

    parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Customer', width: 800, height: 200 },
          { name: 'Supplier', width: 800, height: 200 },
        ],
      })
    );

    const reg = (await import('../../src/diagram-manager'))
      .getDiagram(diagramId)!
      .modeler.get('elementRegistry');
    const pools = reg.filter((el: any) => el.type === 'bpmn:Participant');
    const custPool = pools.find((p: any) => p.businessObject?.name === 'Customer');
    const suppPool = pools.find((p: any) => p.businessObject?.name === 'Supplier');

    // Customer lane
    const cs = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Place Order',
        participantId: custPool.id,
      })
    ).elementId;
    const ct = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:SendTask',
        name: 'Send Order',
        participantId: custPool.id,
      })
    ).elementId;
    const ce = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Order Sent',
        participantId: custPool.id,
      })
    ).elementId;

    await handleConnect({ diagramId, sourceElementId: cs, targetElementId: ct });
    await handleConnect({ diagramId, sourceElementId: ct, targetElementId: ce });

    // Supplier lane
    const ss = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Order Received',
        participantId: suppPool.id,
      })
    ).elementId;
    const st = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Process Order',
        participantId: suppPool.id,
      })
    ).elementId;
    const se = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Shipped',
        participantId: suppPool.id,
      })
    ).elementId;

    await handleConnect({ diagramId, sourceElementId: ss, targetElementId: st });
    await handleConnect({ diagramId, sourceElementId: st, targetElementId: se });

    // Message flow
    await handleConnect({
      diagramId,
      sourceElementId: ct,
      targetElementId: ss,
    });

    await handleLayoutDiagram({ diagramId });
    const svg = await exportSvg(diagramId);
    expect(svg).toContain('<svg');
    writeSvg('05-collaboration', svg);
  });

  it('boundary events', async () => {
    const diagramId = await createDiagram('Boundary Events');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Application' });
    const timer = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Timeout',
        hostElementId: task,
      })
    ).elementId;
    const escalation = await addElement(diagramId, 'bpmn:UserTask', { name: 'Escalate' });
    const approve = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
    const endEsc = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Escalated' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: approve });
    await handleConnect({ diagramId, sourceElementId: approve, targetElementId: end });
    await handleConnect({ diagramId, sourceElementId: timer, targetElementId: escalation });
    await handleConnect({ diagramId, sourceElementId: escalation, targetElementId: endEsc });

    await handleLayoutDiagram({ diagramId });
    const svg = await exportSvg(diagramId);
    expect(svg).toContain('<svg');
    writeSvg('06-boundary-events', svg);
  });

  it('complex workflow with mixed gateways', async () => {
    const diagramId = await createDiagram('Complex Workflow');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Order Placed' });
    const validate = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Validate Order' });
    const gw1 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
    const reject = await addElement(diagramId, 'bpmn:SendTask', { name: 'Send Rejection' });
    const fork = await addElement(diagramId, 'bpmn:ParallelGateway');
    const payment = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Payment' });
    const inventory = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Reserve Inventory',
    });
    const joinGw = await addElement(diagramId, 'bpmn:ParallelGateway');
    const ship = await addElement(diagramId, 'bpmn:UserTask', { name: 'Ship Order' });
    const endOk = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Order Fulfilled' });
    const endReject = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Order Rejected' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: validate });
    await handleConnect({ diagramId, sourceElementId: validate, targetElementId: gw1 });
    await handleConnect({
      diagramId,
      sourceElementId: gw1,
      targetElementId: fork,
      label: 'Yes',
    });
    await handleConnect({
      diagramId,
      sourceElementId: gw1,
      targetElementId: reject,
      label: 'No',
    });
    await handleConnect({ diagramId, sourceElementId: reject, targetElementId: endReject });
    await handleConnect({ diagramId, sourceElementId: fork, targetElementId: payment });
    await handleConnect({ diagramId, sourceElementId: fork, targetElementId: inventory });
    await handleConnect({ diagramId, sourceElementId: payment, targetElementId: joinGw });
    await handleConnect({ diagramId, sourceElementId: inventory, targetElementId: joinGw });
    await handleConnect({ diagramId, sourceElementId: joinGw, targetElementId: ship });
    await handleConnect({ diagramId, sourceElementId: ship, targetElementId: endOk });

    await handleLayoutDiagram({ diagramId });
    const svg = await exportSvg(diagramId);
    expect(svg).toContain('<svg');
    writeSvg('07-complex-workflow', svg);
  });
});
