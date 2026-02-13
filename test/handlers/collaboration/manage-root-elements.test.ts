import { describe, test, expect, beforeEach } from 'vitest';
import { handleManageRootElements, handleExportBpmn } from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('manage_bpmn_root_elements', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates root-level message definitions', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleManageRootElements({
        diagramId,
        messages: [
          { id: 'msg_order', name: 'OrderPlaced' },
          { id: 'msg_payment', name: 'PaymentReceived' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.messages).toHaveLength(2);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('bpmn:message');
    expect(xml).toContain('OrderPlaced');
  });

  test('creates root-level signal definitions', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleManageRootElements({
        diagramId,
        signals: [{ id: 'sig_alert', name: 'AlertTriggered' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.signals).toHaveLength(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('bpmn:signal');
    expect(xml).toContain('AlertTriggered');
  });

  test('requires at least one definition', async () => {
    const diagramId = await createDiagram();

    await expect(handleManageRootElements({ diagramId })).rejects.toThrow(/at least one/i);
  });
});
