/**
 * Tests for list_bpmn_elements' large-diagram summarization (ADR-023):
 * an unfiltered call beyond LARGE_LIST_COUNT elements returns a type-count
 * summary plus a bpmn://diagram/{id}/elements resource_link instead of the
 * full array, unless `inline: true` is passed. Filtered queries always
 * return in full.
 */
import { describe, test, expect } from 'vitest';
import { handleCreateDiagram, handleAddElement, handleListElements } from '../../../src/handlers';
import { createDiagram, createSimpleProcess, clearDiagrams } from '../../helpers';
import { LARGE_LIST_COUNT } from '../../../src/constants';

async function createManyElements(count: number): Promise<string> {
  const create = await handleCreateDiagram({ name: 'Many elements' });
  const diagramId = JSON.parse(create.content[0].text).diagramId;
  for (let i = 0; i < count; i++) {
    await handleAddElement({ diagramId, elementType: 'bpmn:UserTask', name: `Task ${i}` });
  }
  return diagramId;
}

describe('list_bpmn_elements — resource_link summarization for large lists', () => {
  test('small diagram still returns the full element array by default', async () => {
    const diagramId = await createDiagram('Small');
    await createSimpleProcess(diagramId);

    const res = JSON.parse((await handleListElements({ diagramId } as any)).content[0].text!);
    expect(Array.isArray(res.elements)).toBe(true);
    expect(res.elements.length).toBeGreaterThan(0);
  });

  test('large unfiltered diagram returns a type-count summary + resource_link', async () => {
    clearDiagrams();
    const count = LARGE_LIST_COUNT + 5;
    const diagramId = await createManyElements(count);

    const result = await handleListElements({ diagramId } as any);
    const data = JSON.parse(result.content[0].text!);
    expect(data.elements).toBeUndefined();
    expect(data.count).toBe(count);
    expect(data.summaryByType['bpmn:UserTask']).toBe(count);
    expect(data.resource).toBe(`bpmn://diagram/${diagramId}/elements`);

    const linkItem = result.content.find((c: any) => c.type === 'resource_link') as any;
    expect(linkItem).toBeDefined();
    expect(linkItem.uri).toBe(`bpmn://diagram/${diagramId}/elements`);
  }, 30000);

  test('large diagram with inline:true still returns the full array', async () => {
    clearDiagrams();
    const count = LARGE_LIST_COUNT + 5;
    const diagramId = await createManyElements(count);

    const result = await handleListElements({ diagramId, inline: true } as any);
    const data = JSON.parse(result.content[0].text!);
    expect(data.elements.length).toBe(count);
  }, 30000);

  test('a filtered query on a large diagram always returns in full', async () => {
    clearDiagrams();
    const count = LARGE_LIST_COUNT + 5;
    const diagramId = await createManyElements(count);

    const result = await handleListElements({ diagramId, elementType: 'bpmn:UserTask' } as any);
    const data = JSON.parse(result.content[0].text!);
    expect(data.elements.length).toBe(count);
  }, 30000);
});
