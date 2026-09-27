/**
 * Tests for `structuredContent` (ADR-024): jsonResult() additively sets
 * `structuredContent` to the same object serialized in `content[0].text`,
 * so MCP clients that understand it can consume structured JSON directly
 * while `JSON.parse(result.content[0].text)` (the pattern ~1500 existing
 * tests use via `parseResult()`) keeps working unchanged.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElement,
  handleListElements,
  handleValidate,
  handleListDiagrams,
} from '../src/handlers';
import { clearDiagrams } from './helpers';

describe('structuredContent', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('jsonResult-based handlers set structuredContent matching content[0].text', async () => {
    const create = await handleCreateDiagram({ name: 'SC Test' });
    expect(create.structuredContent).toBeDefined();
    expect(create.structuredContent).toEqual(JSON.parse(create.content[0].text!));

    const diagramId = (create.structuredContent as any).diagramId as string;

    const addResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Begin',
    });
    expect(addResult.structuredContent).toEqual(JSON.parse(addResult.content[0].text!));

    const listResult = await handleListElements({ diagramId } as any);
    expect(listResult.structuredContent).toEqual(JSON.parse(listResult.content[0].text!));

    const validateResult = await handleValidate({ diagramId } as any);
    expect(validateResult.structuredContent).toEqual(JSON.parse(validateResult.content[0].text!));

    const diagramsResult = await handleListDiagrams({} as any);
    expect(diagramsResult.structuredContent).toEqual(JSON.parse(diagramsResult.content[0].text!));
  });

  test('content[0].text shape is unchanged (still a plain JSON string)', async () => {
    const result = await handleCreateDiagram({ name: 'Shape Test', includeImage: false });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(typeof result.content[0].text).toBe('string');
    // Still parseable exactly like before this feature existed.
    expect(() => JSON.parse(result.content[0].text!)).not.toThrow();
  });
});
