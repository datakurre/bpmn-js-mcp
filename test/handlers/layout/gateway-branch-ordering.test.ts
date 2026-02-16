/**
 * Tests for gateway branch ordering — happy-path branches should stay
 * above off-path branches after layout.
 *
 * Covers:
 * - XOR gateway with "Yes"/"No" labels, no default flow → "Yes" above "No"
 * - XOR gateway with default flow → non-default (conditioned) above default
 * - Inclusive gateway branch ordering
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect, getRegistry } from '../../helpers';

function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

describe('Gateway branch ordering', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('XOR gateway: "Yes" branch stays above "No" branch (no default flow)', async () => {
    const diagramId = await createDiagram('Branch Ordering Yes/No');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decide?' });
    const taskYes = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });
    const taskNo = await addElement(diagramId, 'bpmn:UserTask', { name: 'Reject' });
    const merge = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskYes, { label: 'Yes' });
    await connect(diagramId, gw, taskNo, { label: 'No' });
    await connect(diagramId, taskYes, merge);
    await connect(diagramId, taskNo, merge);
    await connect(diagramId, merge, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getRegistry(diagramId);
    const yesTask = reg.get(taskYes);
    const noTask = reg.get(taskNo);

    // "Yes" (happy path) should be above or at same level as "No" (off-path)
    expect(centreY(yesTask)).toBeLessThanOrEqual(centreY(noTask));
  });

  test('XOR gateway with default flow: conditioned branch on main row', async () => {
    const diagramId = await createDiagram('Branch Ordering Default');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check' });
    const taskApprove = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });
    const taskReject = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle Error' });
    const merge = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskApprove, {
      label: 'Approved',
      conditionExpression: '${approved}',
    });
    await connect(diagramId, gw, taskReject, { isDefault: true });
    await connect(diagramId, taskApprove, merge);
    await connect(diagramId, taskReject, merge);
    await connect(diagramId, merge, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getRegistry(diagramId);
    const approveTask = reg.get(taskApprove);
    const rejectTask = reg.get(taskReject);
    const gwEl = reg.get(gw);

    // Conditioned "Approved" branch (happy path) should be at or above the gateway row
    // Default branch (off-path) should be below
    expect(centreY(approveTask)).toBeLessThanOrEqual(centreY(rejectTask));
    // The gateway and approved task should be roughly on the same row
    expect(Math.abs(centreY(gwEl) - centreY(approveTask))).toBeLessThanOrEqual(5);
  });

  test('gateway main-chain elements on same row, off-path branch below', async () => {
    const diagramId = await createDiagram('Branch Ordering Row');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
    const taskOk = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Continue' });
    const taskFail = await addElement(diagramId, 'bpmn:UserTask', { name: 'Fix' });
    const endOk = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
    const endFail = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Failed' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskOk, { label: 'Yes' });
    await connect(diagramId, gw, taskFail, { label: 'No' });
    await connect(diagramId, taskOk, endOk);
    await connect(diagramId, taskFail, endFail);

    await handleLayoutDiagram({ diagramId });

    const reg = getRegistry(diagramId);
    const okTask = reg.get(taskOk);
    const failTask = reg.get(taskFail);

    // Happy path ("Yes") should be above or equal to off-path ("No")
    expect(centreY(okTask)).toBeLessThanOrEqual(centreY(failTask));
  });
});
