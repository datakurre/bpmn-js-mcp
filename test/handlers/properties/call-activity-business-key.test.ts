import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetCallActivityVariables, handleExportBpmn } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('set_bpmn_call_activity_variables — businessKey', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets businessKey on camunda:in mapping', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Sub' });

    const res = parseResult(
      await handleSetCallActivityVariables({
        diagramId,
        elementId: callId,
        inMappings: [{ businessKey: '${execution.processBusinessKey}' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.inMappingCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:in');
    expect(xml).toContain('businessKey');
    expect(xml).toContain('${execution.processBusinessKey}');
  });

  test('businessKey coexists with source/target mappings', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Sub2' });

    const res = parseResult(
      await handleSetCallActivityVariables({
        diagramId,
        elementId: callId,
        inMappings: [
          { businessKey: '${execution.processBusinessKey}' },
          { source: 'orderId', target: 'inputOrderId' },
        ],
        outMappings: [{ source: 'result', target: 'subResult' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.inMappingCount).toBe(2);
    expect(res.outMappingCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('businessKey');
    expect(xml).toContain('orderId');
    expect(xml).toContain('subResult');
  });
});
