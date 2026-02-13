import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement } from '../../../src/handlers';
import { handleInsertElement } from '../../../src/handlers/elements/insert-element';
import { createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('elementType validation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('add_bpmn_element', () => {
    test('rejects invalid elementType with "did you mean" for case mismatch', async () => {
      const diagramId = await createDiagram('Test');
      await expect(handleAddElement({ diagramId, elementType: 'bpmn:startEvent' })).rejects.toThrow(
        /Invalid elementType "bpmn:startEvent".*Did you mean.*bpmn:StartEvent/
      );
    });

    test('rejects invalid elementType with "did you mean" for typo', async () => {
      const diagramId = await createDiagram('Test');
      await expect(handleAddElement({ diagramId, elementType: 'bpmn:UserTaks' })).rejects.toThrow(
        /Invalid elementType "bpmn:UserTaks".*Did you mean.*bpmn:UserTask/
      );
    });

    test('rejects completely invalid elementType with allowed values', async () => {
      const diagramId = await createDiagram('Test');
      await expect(handleAddElement({ diagramId, elementType: 'bpmn:FooBar' })).rejects.toThrow(
        /Invalid elementType "bpmn:FooBar".*Allowed values:/
      );
    });

    test('rejects non-bpmn-prefixed type', async () => {
      const diagramId = await createDiagram('Test');
      await expect(handleAddElement({ diagramId, elementType: 'StartEvent' })).rejects.toThrow(
        /Invalid elementType "StartEvent".*Did you mean.*bpmn:StartEvent/
      );
    });

    test('accepts valid elementType', async () => {
      const diagramId = await createDiagram('Test');
      const result = await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review',
      });
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('insert_bpmn_element', () => {
    test('rejects invalid elementType with suggestions', async () => {
      const diagramId = await createDiagram('Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      const connResult = await connect(diagramId, start, end);

      await expect(
        handleInsertElement({
          diagramId,
          flowId: connResult,
          elementType: 'bpmn:usertask',
        })
      ).rejects.toThrow(/Invalid elementType "bpmn:usertask".*Did you mean.*bpmn:UserTask/);
    });

    test('rejects non-insertable types with suggestions', async () => {
      const diagramId = await createDiagram('Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      const connResult = await connect(diagramId, start, end);

      // bpmn:BoundaryEvent is not in INSERTABLE_ELEMENT_TYPES
      await expect(
        handleInsertElement({
          diagramId,
          flowId: connResult,
          elementType: 'bpmn:BoundaryEvent',
        })
      ).rejects.toThrow(/Invalid elementType "bpmn:BoundaryEvent"/);
    });
  });
});
