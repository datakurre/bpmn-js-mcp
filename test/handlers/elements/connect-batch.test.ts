/**
 * Tests for connect_bpmn_elements' `connections[]` batch form (issue #22
 * item 2) — arbitrary source/target pairs (e.g. a gateway's branches with
 * per-branch conditions and a default flow) in one call, applied as a
 * single undo step.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleConnect, handleExportBpmn, handleBpmnHistory } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('connect_bpmn_elements — connections batch form', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates a gateway fan-out with conditions and a default flow in one call', async () => {
    const diagramId = await createDiagram();
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check?' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Approve' });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });
    const taskC = await addElement(diagramId, 'bpmn:Task', { name: 'Escalate' });

    const res = parseResult(
      await handleConnect({
        diagramId,
        connections: [
          { sourceElementId: gw, targetElementId: taskA, conditionExpression: '${valid == true}' },
          {
            sourceElementId: gw,
            targetElementId: taskB,
            conditionExpression: '${valid == false}',
          },
          { sourceElementId: gw, targetElementId: taskC, isDefault: true },
        ],
      })
    );
    expect(res.success).toBe(true);
    expect(res.connections).toHaveLength(3);
    expect(res.connections.every((c: any) => c.connectionId)).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect((xml.match(/<bpmn:sequenceFlow/g) ?? []).length).toBe(3);
    expect(xml).toContain('valid == true');
    expect(xml).toContain('valid == false');
  });

  test('rejects an unknown element in a later item before mutating anything', async () => {
    const diagramId = await createDiagram();
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check?' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Approve' });

    await expect(
      handleConnect({
        diagramId,
        connections: [
          { sourceElementId: gw, targetElementId: taskA },
          { sourceElementId: gw, targetElementId: 'no-such-element' },
        ],
      })
    ).rejects.toThrow(/connections\[1\]/);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).not.toContain('<bpmn:sequenceFlow');
  });

  test('rejects an EndEvent as a batch item source before mutating anything', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { x: 300, y: 100 });
    const task = await addElement(diagramId, 'bpmn:Task', { x: 500, y: 100 });

    await expect(
      handleConnect({
        diagramId,
        connections: [
          { sourceElementId: start, targetElementId: end },
          { sourceElementId: end, targetElementId: task },
        ],
      })
    ).rejects.toThrow(/connections\[1\].*EndEvent is a flow sink/);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).not.toContain('<bpmn:sequenceFlow');
  });

  test('rolls back an earlier connection when a later item is a cross-pool MessageFlow violation', async () => {
    const diagramId = await createDiagram();
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'A' });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'B' });
    const taskC = await addElement(diagramId, 'bpmn:Task', { name: 'C' });

    await expect(
      handleConnect({
        diagramId,
        connections: [
          { sourceElementId: taskA, targetElementId: taskB },
          // taskA and taskC are in the same (implicit) participant — MessageFlow is illegal here.
          { sourceElementId: taskA, targetElementId: taskC, connectionType: 'bpmn:MessageFlow' },
        ],
      })
    ).rejects.toThrow(/Batch connect failed/);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).not.toContain('<bpmn:sequenceFlow');
  });

  test('skips a duplicate pair within the batch and still reports success', async () => {
    const diagramId = await createDiagram();
    const a = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const b = await addElement(diagramId, 'bpmn:EndEvent', { x: 300, y: 100 });
    const c = await addElement(diagramId, 'bpmn:Task', { x: 500, y: 100 });

    // Pre-existing flow a→b, created outside the batch.
    await handleConnect({ diagramId, sourceElementId: a, targetElementId: c });

    const res = parseResult(
      await handleConnect({
        diagramId,
        connections: [
          { sourceElementId: a, targetElementId: c }, // duplicate — should skip
          { sourceElementId: a, targetElementId: b },
        ],
      })
    );
    expect(res.success).toBe(true);
    expect(res.connections[0].skipped).toBe(true);
    expect(res.connections[1].skipped).toBeUndefined();
  });

  test('is undoable as a single step via bpmn_history', async () => {
    const diagramId = await createDiagram();
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check?' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Approve' });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });

    await handleConnect({
      diagramId,
      connections: [
        { sourceElementId: gw, targetElementId: taskA },
        { sourceElementId: gw, targetElementId: taskB },
      ],
    });

    let xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect((xml.match(/<bpmn:sequenceFlow/g) ?? []).length).toBe(2);

    const undoResult = parseResult(
      await handleBpmnHistory({ diagramId, action: 'undo', steps: 1 })
    );
    expect(undoResult.stepsPerformed).toBe(1);

    xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).not.toContain('<bpmn:sequenceFlow');
  });

  test('rejects an empty connections array', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });

    await expect(handleConnect({ diagramId, connections: [] })).rejects.toThrow(/non-empty array/);
  });

  test('runs autoLayout once after the whole batch when requested', async () => {
    const diagramId = await createDiagram();
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check?' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Approve' });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });

    const res = parseResult(
      await handleConnect({
        diagramId,
        connections: [
          { sourceElementId: gw, targetElementId: taskA },
          { sourceElementId: gw, targetElementId: taskB },
        ],
        autoLayout: true,
      })
    );
    expect(res.success).toBe(true);
  });
});
