/**
 * add_bpmn_element's multi-element form (`elements`, ADR-032) — the former
 * add_bpmn_element_chain tool, reached through the public tool dispatch.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { dispatchToolCall, TOOL_DEFINITIONS } from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('add_bpmn_element elements form', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('add_bpmn_element_chain is no longer a tool', async () => {
    expect(TOOL_DEFINITIONS.some((t) => t.name === 'add_bpmn_element_chain')).toBe(false);
    await expect(dispatchToolCall('add_bpmn_element_chain', {})).rejects.toThrow();
  });

  test('schema exposes elements, connect and autoLayout without requiring elementType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element') as any;
    expect(tool.inputSchema.properties).toHaveProperty('elements');
    expect(tool.inputSchema.properties.connect.enum).toEqual(['chain', 'none']);
    expect(tool.inputSchema.required).toEqual(['diagramId']);
  });

  test('connects elements in a chain by default', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await dispatchToolCall('add_bpmn_element', {
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Review' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
      })
    );
    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(3);
    expect(Object.keys(res.connectionIds)).toHaveLength(2);
  });

  test("connect: 'none' adds elements without connecting them", async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await dispatchToolCall('add_bpmn_element', {
        diagramId,
        connect: 'none',
        elements: [
          { elementType: 'bpmn:UserTask', name: 'A', x: 200, y: 200 },
          { elementType: 'bpmn:ServiceTask', name: 'B', x: 400, y: 200 },
        ],
      })
    );
    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(2);
    expect(res.connectionIds).toEqual({});
  });

  test('single form still works', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await dispatchToolCall('add_bpmn_element', {
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Solo',
      })
    );
    expect(res.success).toBe(true);
    expect(res.elementId).toBeDefined();
  });

  test('rejects mixing elements with single-element parameters', async () => {
    const diagramId = await createDiagram();
    await expect(
      dispatchToolCall('add_bpmn_element', {
        diagramId,
        elementType: 'bpmn:UserTask',
        elements: [{ elementType: 'bpmn:EndEvent' }],
      })
    ).rejects.toThrow(/cannot be combined with elementType/);
  });
});
