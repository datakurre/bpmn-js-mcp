import { describe, test, expect, beforeEach } from 'vitest';
import { handleDeleteDiagram, handleExportBpmn } from '../../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../../helpers';

describe('delete_bpmn_diagram', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('deletes an existing diagram', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(await handleDeleteDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Attempting to use the deleted diagram should fail
    await expect(handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).rejects.toThrow(
      /Diagram not found/
    );
  });

  test('throws for unknown diagram', async () => {
    await expect(handleDeleteDiagram({ diagramId: 'nope' })).rejects.toThrow(/Diagram not found/);
  });
});
