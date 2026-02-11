import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetCamundaListeners, handleExportBpmn } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('handleSetCamundaErrorEventDefinition', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets camunda:ErrorEventDefinition on a service task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'External Task',
    });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        errorDefinitions: [
          {
            id: 'CamundaError_1',
            expression: '${error.code == "ERR_001"}',
            errorRef: {
              id: 'Error_Biz',
              name: 'Business Error',
              errorCode: 'BIZ_ERR',
            },
          },
        ],
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:errorEventDefinition');
  });

  test('throws for non-service-task element', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'User Task',
    });

    await expect(
      handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        errorDefinitions: [{ id: 'err1' }],
      })
    ).rejects.toThrow(/only supported on/);
  });
});
