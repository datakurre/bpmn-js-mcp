/**
 * Tests for camunda:resource support in set_bpmn_script.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';
import { handleSetScript } from '../../../src/handlers/properties/set-script';
import { handleGetProperties } from '../../../src/handlers/elements/get-properties';

afterEach(() => clearDiagrams());

describe('set_bpmn_script resource support', () => {
  test('sets an external script resource', async () => {
    const diagramId = await createDiagram();
    const scriptTaskId = await addElement(diagramId, 'bpmn:ScriptTask', { name: 'Run Script' });

    const result = parseResult(
      await handleSetScript({
        diagramId,
        elementId: scriptTaskId,
        scriptFormat: 'groovy',
        resource: 'classpath://scripts/process.groovy',
      })
    );

    expect(result.success).toBe(true);
    expect(result.resource).toBe('classpath://scripts/process.groovy');

    const propsResult = parseResult(
      await handleGetProperties({ diagramId, elementId: scriptTaskId })
    );
    expect(propsResult.camundaProperties?.['camunda:resource']).toBe(
      'classpath://scripts/process.groovy'
    );
  });

  test('rejects setting both script and resource', async () => {
    const diagramId = await createDiagram();
    const scriptTaskId = await addElement(diagramId, 'bpmn:ScriptTask', { name: 'Run Script' });

    await expect(
      handleSetScript({
        diagramId,
        elementId: scriptTaskId,
        scriptFormat: 'groovy',
        script: 'println "hello"',
        resource: 'classpath://scripts/process.groovy',
      })
    ).rejects.toThrow(/Cannot set both/);
  });

  test('rejects setting neither script nor resource', async () => {
    const diagramId = await createDiagram();
    const scriptTaskId = await addElement(diagramId, 'bpmn:ScriptTask', { name: 'Run Script' });

    await expect(
      handleSetScript({
        diagramId,
        elementId: scriptTaskId,
        scriptFormat: 'groovy',
      })
    ).rejects.toThrow(/Either script.*or resource/);
  });
});
