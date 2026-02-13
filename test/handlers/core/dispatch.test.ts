import { describe, test, expect, beforeEach } from 'vitest';
import { dispatchToolCall } from '../../../src/handlers';
import { parseResult, clearDiagrams } from '../../helpers';

describe('dispatchToolCall', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('routes create_bpmn_diagram correctly', async () => {
    const res = parseResult(await dispatchToolCall('create_bpmn_diagram', {}));
    expect(res.success).toBe(true);
  });

  test('routes new tools correctly', async () => {
    const createRes = parseResult(await dispatchToolCall('create_bpmn_diagram', {}));
    const diagramId = createRes.diagramId;

    // list_bpmn_diagrams
    const listRes = parseResult(await dispatchToolCall('list_bpmn_diagrams', {}));
    expect(listRes.count).toBe(1);

    // validate_bpmn_diagram
    const validateRes = parseResult(await dispatchToolCall('validate_bpmn_diagram', { diagramId }));
    expect(validateRes.issues).toBeDefined();

    // delete_bpmn_diagram
    const deleteRes = parseResult(await dispatchToolCall('delete_bpmn_diagram', { diagramId }));
    expect(deleteRes.success).toBe(true);
  });

  test('throws for unknown tool', async () => {
    await expect(dispatchToolCall('no_such_tool', {})).rejects.toThrow(/Unknown tool/);
  });
});
