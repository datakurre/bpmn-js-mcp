import { describe, it, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../src/tool-definitions';

describe('tool-definitions', () => {
  const toolNames = TOOL_DEFINITIONS.map((t) => t.name);

  it('exports the expected number of tools', () => {
    expect(TOOL_DEFINITIONS.length).toBe(33);
  });

  it.each([
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
    'distribute_bpmn_elements',
    'set_bpmn_input_output_mapping',
    'set_bpmn_event_definition',
    'set_bpmn_form_data',
    'layout_bpmn_diagram',
    'set_bpmn_camunda_error',
    'set_bpmn_loop_characteristics',
    'lint_bpmn_diagram',
    'adjust_bpmn_labels',
    'export_bpmn_subprocess',
    'set_bpmn_script',
    'create_bpmn_data_association',
    'create_bpmn_collaboration',
    'undo_bpmn_change',
    'redo_bpmn_change',
    'diff_bpmn_diagrams',
    'batch_bpmn_operations',
  ])("includes tool '%s'", (name) => {
    expect(toolNames).toContain(name);
  });

  it("every tool has an inputSchema with type 'object'", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('add_bpmn_element requires diagramId and elementType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['diagramId', 'elementType'])
    );
  });

  it('add_bpmn_element enum includes BoundaryEvent and CallActivity', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const enumValues = (tool?.inputSchema.properties as any).elementType.enum;
    expect(enumValues).toContain('bpmn:BoundaryEvent');
    expect(enumValues).toContain('bpmn:CallActivity');
    expect(enumValues).toContain('bpmn:TextAnnotation');
  });

  it('export_bpmn requires diagramId and format', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'export_bpmn');
    expect(tool?.inputSchema.required).toEqual(expect.arrayContaining(['diagramId', 'format']));
    const props = tool?.inputSchema.properties as any;
    expect(props.format.enum).toEqual(['xml', 'svg']);
  });

  it('connect_bpmn_elements has connectionType and conditionExpression params', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const props = tool?.inputSchema.properties as any;
    expect(props.connectionType).toBeDefined();
    expect(props.conditionExpression).toBeDefined();
  });

  it('align_bpmn_elements requires elementIds and alignment', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'align_bpmn_elements');
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['diagramId', 'elementIds', 'alignment'])
    );
  });

  it('set_bpmn_input_output_mapping has inputParameters and outputParameters but not source', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_input_output_mapping');
    const props = tool?.inputSchema.properties as any;
    expect(props.inputParameters).toBeDefined();
    expect(props.outputParameters).toBeDefined();
    // source and sourceExpression should have been removed
    const inputItemProps = props.inputParameters.items.properties;
    expect(inputItemProps.source).toBeUndefined();
    expect(inputItemProps.sourceExpression).toBeUndefined();
  });

  it('set_bpmn_event_definition requires eventDefinitionType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_event_definition');
    expect(tool?.inputSchema.required).toContain('eventDefinitionType');
  });

  it('set_bpmn_form_data requires fields', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_form_data');
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['diagramId', 'elementId', 'fields'])
    );
  });

  it('align_bpmn_elements has compact parameter', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'align_bpmn_elements');
    const props = tool?.inputSchema.properties as any;
    expect(props.compact).toBeDefined();
    expect(props.compact.type).toBe('boolean');
  });

  it('distribute_bpmn_elements has gap parameter', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'distribute_bpmn_elements');
    const props = tool?.inputSchema.properties as any;
    expect(props.gap).toBeDefined();
    expect(props.gap.type).toBe('number');
  });

  it('connect_bpmn_elements has isDefault parameter', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const props = tool?.inputSchema.properties as any;
    expect(props.isDefault).toBeDefined();
    expect(props.isDefault.type).toBe('boolean');
  });

  it('add_bpmn_element enum includes Participant and Lane', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const enumValues = (tool?.inputSchema.properties as any).elementType.enum;
    expect(enumValues).toContain('bpmn:Participant');
    expect(enumValues).toContain('bpmn:Lane');
  });

  it('layout_bpmn_diagram requires diagramId', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'layout_bpmn_diagram');
    expect(tool?.inputSchema.required).toContain('diagramId');
  });

  it('set_bpmn_camunda_error requires errorDefinitions', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_camunda_error');
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['diagramId', 'elementId', 'errorDefinitions'])
    );
  });

  it('set_bpmn_loop_characteristics requires loopType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_loop_characteristics');
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['diagramId', 'elementId', 'loopType'])
    );
  });
});
