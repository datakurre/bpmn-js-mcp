import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('add_bpmn_elements warnings', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when afterElementId is used with x/y', async () => {
    const diagramId = await createDiagram('warn-test');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'My Task',
        afterElementId: startId,
        x: 500,
        y: 300,
      })
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('x/y coordinates were ignored');
    expect(result.warnings[0]).toContain('afterElementId');
  });

  test('no warnings when afterElementId is used without x/y', async () => {
    const diagramId = await createDiagram('no-warn-test');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'My Task',
        afterElementId: startId,
      })
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  test('no warnings when x/y is used without afterElementId', async () => {
    const diagramId = await createDiagram('xy-only-test');

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'My Task',
        x: 200,
        y: 150,
      })
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
  });
});
