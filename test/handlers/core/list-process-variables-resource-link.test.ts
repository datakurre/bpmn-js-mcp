/**
 * Tests for list_bpmn_process_variables' large-diagram summarization (ADR-023):
 * beyond LARGE_LIST_COUNT distinct variables, the full read/write detail is
 * replaced with just the variable names plus a
 * bpmn://diagram/{id}/variables resource_link, unless `inline: true`.
 */
import { describe, test, expect } from 'vitest';
import { handleSetFormData, handleListProcessVariables } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../../helpers';
import { LARGE_LIST_COUNT } from '../../../src/constants';

async function createManyVariables(count: number): Promise<string> {
  const diagramId = await createDiagram('Many variables');
  const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Big Form' });
  const fields = Array.from({ length: count }, (_, i) => ({
    id: `field_${i}`,
    label: `Field ${i}`,
    type: 'string',
  }));
  await handleSetFormData({ diagramId, elementId: taskId, fields });
  return diagramId;
}

describe('list_bpmn_process_variables — resource_link summarization for large lists', () => {
  test('small diagram still returns the full variables array by default', async () => {
    clearDiagrams();
    const diagramId = await createManyVariables(3);

    const res = JSON.parse(
      (await handleListProcessVariables({ diagramId } as any)).content[0].text!
    );
    expect(Array.isArray(res.variables)).toBe(true);
    expect(res.variables.length).toBe(3);
  });

  test('large variable count returns names-only + resource_link', async () => {
    clearDiagrams();
    const count = LARGE_LIST_COUNT + 5;
    const diagramId = await createManyVariables(count);

    const result = await handleListProcessVariables({ diagramId } as any);
    const data = JSON.parse(result.content[0].text!);
    expect(data.variables).toBeUndefined();
    expect(data.variableCount).toBe(count);
    expect(data.names.length).toBe(count);
    expect(data.names).toContain('field_0');
    expect(data.resource).toBe(`bpmn://diagram/${diagramId}/variables`);

    const linkItem = result.content.find((c: any) => c.type === 'resource_link') as any;
    expect(linkItem).toBeDefined();
    expect(linkItem.uri).toBe(`bpmn://diagram/${diagramId}/variables`);
  });

  test('large variable count with inline:true still returns full detail', async () => {
    clearDiagrams();
    const count = LARGE_LIST_COUNT + 5;
    const diagramId = await createManyVariables(count);

    const result = await handleListProcessVariables({ diagramId, inline: true } as any);
    const data = JSON.parse(result.content[0].text!);
    expect(data.variables.length).toBe(count);
    expect(data.variables[0]).toHaveProperty('writtenBy');
  });
});
