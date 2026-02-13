import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetScript } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('set_bpmn_script', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets inline script on a ScriptTask', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ScriptTask', { name: 'MyScript' });

    const res = parseResult(
      await handleSetScript({
        diagramId,
        elementId: taskId,
        scriptFormat: 'groovy',
        script: 'println "Hello"',
      })
    );

    expect(res.success).toBe(true);
    expect(res.scriptFormat).toBe('groovy');
    expect(res.scriptLength).toBe('println "Hello"'.length);

    // Verify on the business object
    const diagram = getDiagram(diagramId)!;
    const registry = diagram.modeler.get('elementRegistry');
    const bo = registry.get(taskId).businessObject;
    expect(bo.scriptFormat).toBe('groovy');
    expect(bo.script).toBe('println "Hello"');
  });

  test('sets resultVariable when provided', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ScriptTask');

    const res = parseResult(
      await handleSetScript({
        diagramId,
        elementId: taskId,
        scriptFormat: 'javascript',
        script: 'var x = 1 + 1;',
        resultVariable: 'myResult',
      })
    );

    expect(res.success).toBe(true);
    expect(res.resultVariable).toBe('myResult');
  });

  test('throws for non-ScriptTask elements', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask');

    await expect(
      handleSetScript({
        diagramId,
        elementId: taskId,
        scriptFormat: 'groovy',
        script: 'println "test"',
      })
    ).rejects.toThrow(/not a ScriptTask/);
  });

  test('includes script in exported XML', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ScriptTask');

    await handleSetScript({
      diagramId,
      elementId: taskId,
      scriptFormat: 'groovy',
      script: 'execution.setVariable("done", true)',
    });

    const diagram = getDiagram(diagramId)!;
    const { xml } = await diagram.modeler.saveXML({ format: true });
    expect(xml).toContain('scriptFormat="groovy"');
    expect(xml).toContain('execution.setVariable("done", true)');
  });
});
