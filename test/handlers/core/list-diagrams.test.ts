import { describe, test, expect, beforeEach } from 'vitest';
import { handleListDiagrams } from '../../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../../helpers';

describe('list_bpmn_diagrams', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('lists all diagrams', async () => {
    await createDiagram('First');
    await createDiagram('Second');

    const res = parseResult(await handleListDiagrams());
    expect(res.count).toBe(2);
    expect(res.diagrams[0].name).toBe('First');
  });

  test('returns empty when no diagrams', async () => {
    const res = parseResult(await handleListDiagrams());
    expect(res.count).toBe(0);
  });
});
