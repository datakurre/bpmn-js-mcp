/**
 * add_bpmn_elements through the public tool dispatch (ADR-032): the former
 * add_bpmn_element and add_bpmn_element_chain tools, merged.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { dispatchToolCall, TOOL_DEFINITIONS } from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('add_bpmn_elements', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test.each(['add_bpmn_element', 'add_bpmn_element_chain'])(
    '%s is no longer a tool (no backwards compatibility)',
    async (name) => {
      expect(TOOL_DEFINITIONS.some((t) => t.name === name)).toBe(false);
      await expect(dispatchToolCall(name, {})).rejects.toThrow();
    }
  );

  test('schema: elements are required and carry the per-element parameters', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_elements') as any;
    const item = tool.inputSchema.properties.elements.items;
    expect(tool.inputSchema.properties.connect.enum).toEqual(['chain', 'none']);
    expect(tool.inputSchema.required).toEqual(['diagramId', 'elements']);
    for (const key of ['elementType', 'hostElementId', 'flowId', 'copyFrom', 'x', 'y']) {
      expect(item.properties).toHaveProperty(key);
    }
  });

  test('connects elements in a chain by default', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await dispatchToolCall('add_bpmn_elements', {
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
      await dispatchToolCall('add_bpmn_elements', {
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
      await dispatchToolCall('add_bpmn_elements', {
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

  test('rejects entry keys that are not single-element parameters', async () => {
    const diagramId = await createDiagram();
    await expect(
      dispatchToolCall('add_bpmn_elements', {
        diagramId,
        elements: [{ elementType: 'bpmn:UserTask', bogus: 1, connect: 'none' }],
      })
    ).rejects.toThrow(/unsupported key.*bogus.*connect/);
  });

  test('rejects an element type outside the allowed list', async () => {
    const diagramId = await createDiagram();
    await expect(
      dispatchToolCall('add_bpmn_elements', {
        diagramId,
        elements: [{ elementType: 'bpmn:Nope' }],
      })
    ).rejects.toThrow();
  });

  test('a single-item array behaves like the single form', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await dispatchToolCall('add_bpmn_elements', {
        diagramId,
        elements: [{ elementType: 'bpmn:UserTask', name: 'Solo' }],
      })
    );
    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(1);
  });

  test('an entry with hostElementId (boundary event) is attached, not chained', async () => {
    const diagramId = await createDiagram();
    const task = parseResult(
      await dispatchToolCall('add_bpmn_elements', {
        diagramId,
        elements: [{ elementType: 'bpmn:UserTask', name: 'Work' }],
      })
    ).elementIds[0];
    const res = parseResult(
      await dispatchToolCall('add_bpmn_elements', {
        diagramId,
        elements: [
          {
            elementType: 'bpmn:BoundaryEvent',
            hostElementId: task,
            eventDefinitionType: 'bpmn:TimerEventDefinition',
            eventDefinitionProperties: { timeDuration: 'PT1H' },
          },
          { elementType: 'bpmn:EndEvent', name: 'Timed out' },
        ],
      })
    );
    expect(res.elementCount).toBe(2);
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
    const boundary = reg.get(res.elementIds[0]);
    expect(boundary.type).toBe('bpmn:BoundaryEvent');
    expect(boundary.host.id).toBe(task);
    // The boundary event itself was not auto-connected from the previous element
    expect(boundary.incoming).toHaveLength(0);
  });

  test('an entry with flowId is inserted into that flow', async () => {
    const diagramId = await createDiagram();
    const chain = parseResult(
      await dispatchToolCall('add_bpmn_elements', {
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
      })
    );
    const flowId = Object.values(chain.connectionIds)[0] as string;
    const res = parseResult(
      await dispatchToolCall('add_bpmn_elements', {
        diagramId,
        elements: [{ elementType: 'bpmn:UserTask', name: 'Inserted', flowId }],
      })
    );
    expect(res.success).toBe(true);
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
    expect(reg.get(flowId)).toBeUndefined();
    expect(reg.get(res.elementIds[0]).incoming).toHaveLength(1);
    expect(reg.get(res.elementIds[0]).outgoing).toHaveLength(1);
  });

  test('an entry with explicit x/y keeps its position (auto-layout off by default)', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await dispatchToolCall('add_bpmn_elements', {
        diagramId,
        elements: [
          { elementType: 'bpmn:UserTask', name: 'A', x: 500, y: 400 },
          { elementType: 'bpmn:UserTask', name: 'B' },
        ],
      })
    );
    expect(res.autoLayoutApplied).toBeUndefined();
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
    const a = reg.get(res.elementIds[0]);
    expect(a.x + a.width / 2).toBe(500);
    expect(a.y + a.height / 2).toBe(400);
  });

  test('requires elements (the single-element form is gone)', async () => {
    const diagramId = await createDiagram();
    await expect(
      dispatchToolCall('add_bpmn_elements', { diagramId, elementType: 'bpmn:UserTask' })
    ).rejects.toThrow(/elements/);
  });

  test('rejects per-element options at the top level', async () => {
    const diagramId = await createDiagram();
    await expect(
      dispatchToolCall('add_bpmn_elements', {
        diagramId,
        elementType: 'bpmn:UserTask',
        elements: [{ elementType: 'bpmn:EndEvent' }],
      })
    ).rejects.toThrow(/must be set inside each entry/);
  });
});
