import { describe, test, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../src/tool-definitions';

describe('tool-definitions', () => {
  const toolNames = TOOL_DEFINITIONS.map((t) => t.name);

  test('exports the expected number of tools', () => {
    expect(TOOL_DEFINITIONS.length).toBe(50);
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
    'clone_bpmn_diagram',
    'validate_bpmn_diagram',
    'align_bpmn_elements',
    'set_bpmn_input_output_mapping',
    'set_bpmn_event_definition',
    'set_bpmn_form_data',
    'layout_bpmn_diagram',
    'set_bpmn_loop_characteristics',
    'adjust_bpmn_labels',
    'set_bpmn_script',
    'create_bpmn_collaboration',
    'bpmn_history',
    'diff_bpmn_diagrams',
    'batch_bpmn_operations',
    'set_bpmn_camunda_listeners',
    'set_bpmn_call_activity_variables',
    'manage_bpmn_root_elements',
    'create_bpmn_lanes',
    'assign_bpmn_elements_to_lane',
    'wrap_bpmn_process_in_collaboration',
    'split_bpmn_participant_into_lanes',
    'duplicate_bpmn_element',
    'insert_bpmn_element',
    'replace_bpmn_element',
    'add_bpmn_element_chain',
    'create_bpmn_participant',
    'handoff_bpmn_to_lane',
    'suggest_bpmn_lane_organization',
    'validate_bpmn_lane_organization',
    'convert_bpmn_collaboration_to_lanes',
    'resize_bpmn_pool_to_fit',
    'suggest_bpmn_pool_vs_lanes',
    'optimize_bpmn_lane_assignments',
    'summarize_bpmn_diagram',
    'list_bpmn_process_variables',
    'set_bpmn_connection_waypoints',
  ])("includes tool '%s'", (name) => {
    expect(toolNames).toContain(name);
  });

  test("every tool has an inputSchema with type 'object'", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  test('add_bpmn_element requires diagramId and elementType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['diagramId', 'elementType'])
    );
  });

  test('add_bpmn_element enum includes BoundaryEvent and CallActivity', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const enumValues = (tool?.inputSchema.properties as any).elementType.enum;
    expect(enumValues).toContain('bpmn:BoundaryEvent');
    expect(enumValues).toContain('bpmn:CallActivity');
    expect(enumValues).toContain('bpmn:TextAnnotation');
  });

  test('export_bpmn requires diagramId and format', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'export_bpmn');
    expect(tool?.inputSchema.required).toEqual(expect.arrayContaining(['diagramId', 'format']));
    const props = tool?.inputSchema.properties as any;
    expect(props.format.enum).toEqual(['xml', 'svg', 'both']);
  });

  test('connect_bpmn_elements has connectionType and conditionExpression params', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const props = tool?.inputSchema.properties as any;
    expect(props.connectionType).toBeDefined();
    expect(props.conditionExpression).toBeDefined();
  });

  test('align_bpmn_elements requires diagramId and elementIds', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'align_bpmn_elements');
    expect(tool?.inputSchema.required).toEqual(expect.arrayContaining(['diagramId', 'elementIds']));
  });

  test('set_bpmn_input_output_mapping has inputParameters and outputParameters but not source', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_input_output_mapping');
    const props = tool?.inputSchema.properties as any;
    expect(props.inputParameters).toBeDefined();
    expect(props.outputParameters).toBeDefined();
    // source and sourceExpression should have been removed
    const inputItemProps = props.inputParameters.items.properties;
    expect(inputItemProps.source).toBeUndefined();
    expect(inputItemProps.sourceExpression).toBeUndefined();
  });

  test('set_bpmn_event_definition requires eventDefinitionType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_event_definition');
    expect(tool?.inputSchema.required).toContain('eventDefinitionType');
  });

  test('set_bpmn_form_data requires fields', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_form_data');
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['diagramId', 'elementId', 'fields'])
    );
  });

  test('align_bpmn_elements has compact and distribute parameters', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'align_bpmn_elements');
    const props = tool?.inputSchema.properties as any;
    expect(props.compact).toBeDefined();
    expect(props.compact.type).toBe('boolean');
    expect(props.orientation).toBeDefined();
    expect(props.gap).toBeDefined();
    expect(props.gap.type).toBe('number');
  });

  test('connect_bpmn_elements has isDefault parameter', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const props = tool?.inputSchema.properties as any;
    expect(props.isDefault).toBeDefined();
    expect(props.isDefault.type).toBe('boolean');
  });

  test('add_bpmn_element enum includes Participant and Lane', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const enumValues = (tool?.inputSchema.properties as any).elementType.enum;
    expect(enumValues).toContain('bpmn:Participant');
    expect(enumValues).toContain('bpmn:Lane');
  });

  test('layout_bpmn_diagram requires diagramId', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'layout_bpmn_diagram');
    expect(tool?.inputSchema.required).toContain('diagramId');
  });

  test('set_bpmn_camunda_listeners has errorDefinitions parameter', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_camunda_listeners');
    const props = tool?.inputSchema.properties as any;
    expect(props.errorDefinitions).toBeDefined();
    expect(props.errorDefinitions.type).toBe('array');
  });

  test('set_bpmn_loop_characteristics requires loopType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_loop_characteristics');
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['diagramId', 'elementId', 'loopType'])
    );
  });
});
