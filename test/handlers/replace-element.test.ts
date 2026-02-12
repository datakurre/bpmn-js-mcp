/**
 * Tests for replace_bpmn_element tool.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { handleReplaceElement } from '../../src/handlers/replace-element';
import { handleListElements } from '../../src/handlers/list-elements';
import { clearDiagrams } from '../../src/diagram-manager';
import { parseResult, createDiagram, addElement, connect } from '../helpers';

afterEach(() => clearDiagrams());

describe('replace_bpmn_element', () => {
  test('should replace element type preserving connections', async () => {
    const diagramId = await createDiagram('replace-test');

    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Do Work',
      x: 300,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 500,
      y: 100,
    });

    await connect(diagramId, startId, taskId);
    await connect(diagramId, taskId, endId);

    // Replace Task → UserTask
    const replaceResult = parseResult(
      await handleReplaceElement({
        diagramId,
        elementId: taskId,
        newType: 'bpmn:UserTask',
      })
    );
    expect(replaceResult.success).toBe(true);
    expect(replaceResult.newType).toBe('bpmn:UserTask');
    expect(replaceResult.oldType).toBe('bpmn:Task');

    // Verify the replacement has connections
    const elements = parseResult(await handleListElements({ diagramId }));
    const userTask = elements.elements.find((el: any) => el.type === 'bpmn:UserTask');
    expect(userTask).toBeDefined();
    expect(userTask.incoming).toBeDefined();
    expect(userTask.outgoing).toBeDefined();
  });

  test('should no-op when replacing to same type', async () => {
    const diagramId = await createDiagram('replace-noop');
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Test' });

    const result = parseResult(
      await handleReplaceElement({
        diagramId,
        elementId: taskId,
        newType: 'bpmn:UserTask',
      })
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('no change needed');
  });
});
