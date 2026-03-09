/**
 * Tests that batch_bpmn_operations final response includes image content
 * when the diagram was created with includeImage.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateDiagram, handleBatchOperations } from '../../../src/handlers';
import { parseResult, clearDiagrams } from '../../helpers';

describe('batch_bpmn_operations image output', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('final batch result includes PNG image when diagram has includeImage:true', async () => {
    const createResult = await handleCreateDiagram({ includeImage: true });
    const { diagramId } = parseResult(createResult);

    const batchResult = await handleBatchOperations({
      operations: [
        { tool: 'add_bpmn_element', args: { diagramId, elementType: 'bpmn:StartEvent', name: 'Start' } },
        { tool: 'add_bpmn_element', args: { diagramId, elementType: 'bpmn:EndEvent', name: 'End' } },
      ],
    });

    const imageItems = batchResult.content.filter((c: any) => c.type === 'image');
    expect(imageItems.length).toBeGreaterThan(0);
    expect((imageItems[0] as any).mimeType).toBe('image/png');
  });

  test('final batch result has no image when includeImage:false', async () => {
    const createResult = await handleCreateDiagram({ includeImage: false });
    const { diagramId } = parseResult(createResult);

    const batchResult = await handleBatchOperations({
      operations: [
        { tool: 'add_bpmn_element', args: { diagramId, elementType: 'bpmn:StartEvent', name: 'Start' } },
      ],
    });

    const imageItems = batchResult.content.filter((c: any) => c.type === 'image');
    expect(imageItems.length).toBe(0);
  });
});
