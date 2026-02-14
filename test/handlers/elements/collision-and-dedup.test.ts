import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement, handleValidate as handleLintDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connectAll, clearDiagrams } from '../../helpers';

describe('collision avoidance', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('shifts element when default position overlaps existing element', async () => {
    const diagramId = await createDiagram('collision-test');

    // Add first element at default position
    const _firstId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    // Add second element also at default position — should be shifted
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task A',
      })
    );

    expect(result.success).toBe(true);
    // The task should not be at the same position as the start event
    expect(result.position.x).not.toBe(100);
  });

  test('does not shift when position is explicitly given', async () => {
    const diagramId = await createDiagram('no-collision');
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    // Explicitly give a position far away — no collision expected
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task B',
        x: 500,
        y: 500,
      })
    );

    expect(result.success).toBe(true);
    expect(result.position.x).toBe(500);
    expect(result.position.y).toBe(500);
  });

  test('does not shift when afterElementId provides positioning', async () => {
    const diagramId = await createDiagram('after-collision');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    // afterElementId already calculates position — collision avoidance is skipped
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task C',
        afterElementId: startId,
      })
    );

    expect(result.success).toBe(true);
  });
});

describe('duplicate detection warning', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when adding element with same type and name', async () => {
    const diagramId = await createDiagram('dedup-test');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Order',
      })
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(
      result.warnings.some((w: string) => w.includes('same type') && w.includes('Review Order'))
    ).toBe(true);
  });

  test('no warning when name differs', async () => {
    const diagramId = await createDiagram('no-dedup');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Approve Order',
      })
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  test('no warning when type differs', async () => {
    const diagramId = await createDiagram('diff-type');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Process' });

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process',
      })
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  test('no warning when element has no name', async () => {
    const diagramId = await createDiagram('unnamed');
    await addElement(diagramId, 'bpmn:UserTask');

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
      })
    );

    expect(result.success).toBe(true);
    // Unnamed elements should not trigger duplicate warnings
    expect(result.warnings).toBeUndefined();
  });
});

describe('process-too-complex lint rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when process exceeds 30 flow nodes', async () => {
    const diagramId = await createDiagram('complex-process');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    let prev = start;
    // Add 31 tasks (plus start = 32 flow nodes)
    for (let i = 1; i <= 31; i++) {
      const task = await addElement(diagramId, 'bpmn:UserTask', {
        name: `Task ${i}`,
        afterElementId: prev,
      });
      prev = task;
    }

    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      afterElementId: prev,
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/process-too-complex': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/process-too-complex');
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('flow nodes');
    expect(issues[0].message).toContain('threshold: 30');
  });

  test('no warning for simple process', async () => {
    const diagramId = await createDiagram('simple-process');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task',
      afterElementId: start,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      afterElementId: task,
    });

    await connectAll(diagramId, start, task, end);

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/process-too-complex': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/process-too-complex');
    expect(issues.length).toBe(0);
  });
});
