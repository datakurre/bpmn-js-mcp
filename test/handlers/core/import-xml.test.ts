import { describe, test, expect, beforeEach } from 'vitest';
import { handleImportXml } from '../../../src/handlers';
import { INITIAL_XML } from '../../../src/diagram-manager';
import { parseResult, clearDiagrams } from '../../helpers';

describe('import_bpmn_xml', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('imports valid BPMN XML and returns a new diagramId', async () => {
    const res = parseResult(await handleImportXml({ xml: INITIAL_XML }));
    expect(res.success).toBe(true);
    expect(res.diagramId).toMatch(/^diagram_/);
  });
});
