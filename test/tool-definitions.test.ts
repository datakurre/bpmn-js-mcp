import { describe, test, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../src/tool-definitions';

/** Helper to extract typed inputSchema from a tool definition. */
function getSchema(tool: (typeof TOOL_DEFINITIONS)[number] | undefined) {
  return tool?.inputSchema as {
    type: string;
    required?: string[];
    properties?: Record<string, any>;
  };
}

describe('tool-definitions', () => {
  const toolNames = TOOL_DEFINITIONS.map((t) => t.name);

  test('exports the expected number of tools', () => {
    expect(TOOL_DEFINITIONS.length).toBe(25);
  });

  test.each([
    'create_bpmn_diagram',
    'add_bpmn_element',
    'connect_bpmn_elements',
    'delete_bpmn_element',
    'move_bpmn_element',
    'get_bpmn_element_properties',
    'export_bpmn',
    'list_bpmn_elements',
    'set_bpmn_element_properties',
    'import_bpmn_xml',
    'delete_bpmn_diagram',
    'list_bpmn_diagrams',
    'validate_bpmn_diagram',
    'align_bpmn_elements',
    'set_bpmn_event_definition',
    'layout_bpmn_diagram',
    'bpmn_history',
    'batch_bpmn_operations',
    'manage_bpmn_root_elements',
    'create_bpmn_lanes',
    'create_bpmn_participant',
    'analyze_bpmn_lanes',
    // redistribute_bpmn_elements_across_lanes removed — use analyze_bpmn_lanes with mode: redistribute
    // replace_bpmn_element removed — use set_bpmn_element_properties with elementType
    'list_bpmn_process_variables',
    // clone_bpmn_diagram removed — use create_bpmn_diagram with cloneFrom
    // diff_bpmn_diagrams removed — use list_bpmn_diagrams with compareWith
    'add_bpmn_element_chain',
    // set_bpmn_connection_waypoints removed — use connect_bpmn_elements with connectionId + waypoints
    'assign_bpmn_elements_to_lane',
    // wrap_bpmn_process_in_collaboration removed — use create_bpmn_participant with wrapExisting
    // handoff_bpmn_to_lane removed — use add_bpmn_element with fromElementId + toLaneId
    // convert_bpmn_collaboration_to_lanes removed — use create_bpmn_lanes with mergeFrom
    // autosize_bpmn_pools_and_lanes removed — use layout_bpmn_diagram with autosizeOnly
    // set_bpmn_input_output_mapping, set_bpmn_form_data, set_bpmn_camunda_listeners,
    // set_bpmn_call_activity_variables, set_bpmn_loop_characteristics: hidden aliases
    // (ADR-021) — use set_bpmn_element_properties's inputOutput/formData/listeners/
    // callActivityVariables/loop sub-objects
  ])("includes tool '%s'", (name) => {
    expect(toolNames).toContain(name);
  });

  test.each([
    'set_bpmn_input_output_mapping',
    'set_bpmn_form_data',
    'set_bpmn_camunda_listeners',
    'set_bpmn_call_activity_variables',
    'set_bpmn_loop_characteristics',
  ])(
    "'%s' is a hidden alias — not listed in TOOL_DEFINITIONS but still dispatchable",
    async (name) => {
      expect(toolNames).not.toContain(name);
      const { dispatchToolCall } = await import('../src/handlers/index');
      // Calling with no args should fail on missing required params, not "Unknown tool".
      await expect(dispatchToolCall(name, {})).rejects.toThrow(/diagramId|elementId/i);
    }
  );

  test('create_bpmn_diagram has cloneFrom parameter (merged from clone_bpmn_diagram)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'create_bpmn_diagram');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('cloneFrom');
  });

  test('create_bpmn_participant has wrapExisting parameter (merged from wrap_bpmn_process_in_collaboration)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'create_bpmn_participant');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('wrapExisting');
  });

  test('create_bpmn_lanes has mergeFrom parameter (merged from convert_bpmn_collaboration_to_lanes)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'create_bpmn_lanes');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('mergeFrom');
  });

  test('list_bpmn_diagrams has compareWith parameter (merged from diff_bpmn_diagrams)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'list_bpmn_diagrams');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('compareWith');
  });

  test('layout_bpmn_diagram has autosizeOnly parameter (merged from autosize_bpmn_pools_and_lanes)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'layout_bpmn_diagram');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('autosizeOnly');
  });

  test('analyze_bpmn_lanes has redistribute mode (merged from redistribute_bpmn_elements_across_lanes)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'analyze_bpmn_lanes');
    const schema = getSchema(tool);
    expect(schema.properties!.mode.enum).toContain('redistribute');
  });

  test('set_bpmn_element_properties has elementType parameter (merged from replace_bpmn_element)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_element_properties');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('elementType');
  });

  test('connect_bpmn_elements has connectionId and waypoints parameters (merged from set_bpmn_connection_waypoints)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('connectionId');
    expect(schema.properties).toHaveProperty('waypoints');
  });

  test("every tool has an inputSchema with type 'object'", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const schema = getSchema(tool);
      expect(schema.type).toBe('object');
    }
  });

  test('add_bpmn_element requires diagramId and elementType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'elementType']));
  });

  test('add_bpmn_element enum includes BoundaryEvent and CallActivity', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const schema = getSchema(tool);
    const enumValues = schema.properties!.elementType.enum;
    expect(enumValues).toContain('bpmn:BoundaryEvent');
    expect(enumValues).toContain('bpmn:CallActivity');
    expect(enumValues).toContain('bpmn:TextAnnotation');
  });

  test('export_bpmn requires diagramId, format, and filePath', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'export_bpmn');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'format', 'filePath']));
    expect(schema.properties!.format.enum).toEqual(['xml', 'svg', 'both']);
  });

  test('connect_bpmn_elements has connectionType and conditionExpression params', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.properties!.connectionType).toBeDefined();
    expect(schema.properties!.conditionExpression).toBeDefined();
  });

  test('align_bpmn_elements requires diagramId and elementIds', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'align_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'elementIds']));
  });

  test('set_bpmn_element_properties.inputOutput has inputParameters and outputParameters but not source', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_element_properties');
    const schema = getSchema(tool);
    const ioProps = schema.properties!.inputOutput.properties;
    expect(ioProps.inputParameters).toBeDefined();
    expect(ioProps.outputParameters).toBeDefined();
    // source and sourceExpression should have been removed
    const inputItemProps = ioProps.inputParameters.items.properties;
    expect(inputItemProps.source).toBeUndefined();
    expect(inputItemProps.sourceExpression).toBeUndefined();
  });

  test('set_bpmn_event_definition requires eventDefinitionType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_event_definition');
    const schema = getSchema(tool);
    expect(schema.required).toContain('eventDefinitionType');
  });

  test('set_bpmn_element_properties.formData requires fields', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_element_properties');
    const schema = getSchema(tool);
    expect(schema.properties!.formData.required).toEqual(expect.arrayContaining(['fields']));
  });

  test('align_bpmn_elements has compact and distribute parameters', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'align_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.properties!.compact).toBeDefined();
    expect(schema.properties!.compact.type).toBe('boolean');
    expect(schema.properties!.orientation).toBeDefined();
    expect(schema.properties!.gap).toBeDefined();
    expect(schema.properties!.gap.type).toBe('number');
  });

  test('connect_bpmn_elements has isDefault parameter', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.properties!.isDefault).toBeDefined();
    expect(schema.properties!.isDefault.type).toBe('boolean');
  });

  test('add_bpmn_element enum includes Participant and Lane', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const schema = getSchema(tool);
    const enumValues = schema.properties!.elementType.enum;
    expect(enumValues).toContain('bpmn:Participant');
    expect(enumValues).toContain('bpmn:Lane');
  });

  test('layout_bpmn_diagram requires diagramId', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'layout_bpmn_diagram');
    const schema = getSchema(tool);
    expect(schema.required).toContain('diagramId');
  });

  test('set_bpmn_element_properties.listeners has errorDefinitions parameter', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_element_properties');
    const schema = getSchema(tool);
    const listenersProps = schema.properties!.listeners.properties;
    expect(listenersProps.errorDefinitions).toBeDefined();
    expect(listenersProps.errorDefinitions.type).toBe('array');
  });

  test('set_bpmn_element_properties.loop requires loopType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_element_properties');
    const schema = getSchema(tool);
    expect(schema.properties!.loop.required).toEqual(expect.arrayContaining(['loopType']));
  });

  describe('annotations', () => {
    const readOnlyToolNames = [
      'export_bpmn',
      'list_bpmn_diagrams',
      'list_bpmn_elements',
      'get_bpmn_element_properties',
      'validate_bpmn_diagram',
      'analyze_bpmn_lanes',
      'list_bpmn_process_variables',
    ];

    test('every tool has a title and boolean readOnlyHint/openWorldHint', () => {
      for (const tool of TOOL_DEFINITIONS) {
        const annotations = (tool as any).annotations;
        expect(annotations, `${tool.name} is missing annotations`).toBeDefined();
        expect(typeof annotations.title).toBe('string');
        expect(annotations.title.length).toBeGreaterThan(0);
        expect(typeof annotations.readOnlyHint).toBe('boolean');
        expect(typeof annotations.openWorldHint).toBe('boolean');
      }
    });

    test.each(readOnlyToolNames)('%s has readOnlyHint: true', (name) => {
      const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
      expect((tool as any).annotations.readOnlyHint).toBe(true);
    });

    test.each(['delete_bpmn_diagram', 'delete_bpmn_element'])(
      '%s has destructiveHint: true',
      (name) => {
        const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
        expect((tool as any).annotations.destructiveHint).toBe(true);
      }
    );

    test('non-destructive tools do not set destructiveHint', () => {
      for (const tool of TOOL_DEFINITIONS) {
        if (tool.name === 'delete_bpmn_diagram' || tool.name === 'delete_bpmn_element') continue;
        expect((tool as any).annotations.destructiveHint).toBeUndefined();
      }
    });

    test.each(['import_bpmn_xml', 'export_bpmn'])('%s has openWorldHint: true', (name) => {
      const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
      expect((tool as any).annotations.openWorldHint).toBe(true);
    });

    test('tools other than import/export have openWorldHint: false', () => {
      for (const tool of TOOL_DEFINITIONS) {
        if (tool.name === 'import_bpmn_xml' || tool.name === 'export_bpmn') continue;
        expect((tool as any).annotations.openWorldHint).toBe(false);
      }
    });
  });

  describe('size budget (#6, #8)', () => {
    // The full serialized tool list is loaded by every session before it does
    // anything, so it's a direct, per-session context cost. This budget caps
    // regressions (e.g. a verbose new tool, a re-added examples block) without
    // itself being the primary reduction mechanism: reaching the eventual
    // ~25 KB target on top of this also needs tool tiers (#9), so a core-only
    // tier can stay well under budget even while the full tier carries every
    // tool's complete schema.
    const MAX_TOOL_DEFINITIONS_BYTES = 63 * 1024;

    test(`serialized TOOL_DEFINITIONS stays under ${MAX_TOOL_DEFINITIONS_BYTES} bytes`, () => {
      const bytes = Buffer.byteLength(JSON.stringify(TOOL_DEFINITIONS), 'utf8');
      expect(bytes).toBeLessThan(MAX_TOOL_DEFINITIONS_BYTES);
    });

    test('no tool schema embeds an examples array (moved to bpmn:// guide resources)', () => {
      for (const tool of TOOL_DEFINITIONS) {
        const schema = getSchema(tool);
        expect((schema as any).examples, `${tool.name} still has an examples array`).toBeUndefined();
      }
    });
  });
});
