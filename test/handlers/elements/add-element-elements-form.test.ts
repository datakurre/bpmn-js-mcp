/**
 * add_bpmn_element's multi-element form (`elements`, ADR-032) — the former
 * add_bpmn_element_chain tool, reached through the public tool dispatch.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { dispatchToolCall, TOOL_DEFINITIONS } from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

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

  test("connect: 'none' without x/y places elements at distinct positions, unconnected", async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await dispatchToolCall('add_bpmn_element', {
        diagramId,
        connect: 'none',
        elements: [
          { elementType: 'bpmn:UserTask', name: 'A' },
          { elementType: 'bpmn:UserTask', name: 'B' },
          { elementType: 'bpmn:UserTask', name: 'C' },
        ],
      })
    );
    expect(res.elementCount).toBe(3);
    expect(res.connectionIds).toEqual({});
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
    const xs = (res.elementIds as string[]).map((id) => reg.get(id).x);
    expect(new Set(xs).size).toBe(3);
    expect(reg.filter((e: any) => e.type === 'bpmn:SequenceFlow')).toHaveLength(0);
  });

  test.each([
    ['flowId', { flowId: 'Flow_X' }],
    ['copyFrom', { copyFrom: 'Task_X' }],
    ['afterElementId', { afterElementId: 'Task_X' }],
    ['autoConnect', { autoConnect: false }],
  ])('rejects unsupported per-entry key %s', async (key, extra) => {
    const diagramId = await createDiagram();
    await expect(
      dispatchToolCall('add_bpmn_element', {
        diagramId,
        elements: [{ elementType: 'bpmn:UserTask', ...extra }],
      })
    ).rejects.toThrow(new RegExp(`unsupported key.*${key}`));
  });

  test('rejects per-entry x/y when chaining', async () => {
    const diagramId = await createDiagram();
    await expect(
      dispatchToolCall('add_bpmn_element', {
        diagramId,
        elements: [{ elementType: 'bpmn:UserTask', x: 300, y: 300 }],
      })
    ).rejects.toThrow(/x\/y are ignored when chaining/);
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
