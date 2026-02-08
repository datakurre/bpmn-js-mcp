import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS } from "../src/tool-definitions";

describe("tool-definitions", () => {
  const toolNames = TOOL_DEFINITIONS.map((t) => t.name);

  it("exports the expected number of tools", () => {
    expect(TOOL_DEFINITIONS.length).toBe(22);
  });

  it.each([
    "create_bpmn_diagram",
    "add_bpmn_element",
    "connect_bpmn_elements",
    "delete_bpmn_element",
    "move_bpmn_element",
    "get_element_properties",
    "export_bpmn",
    "list_bpmn_elements",
    "set_element_properties",
    "import_bpmn_xml",
    "delete_diagram",
    "list_diagrams",
    "clone_diagram",
    "validate_bpmn_diagram",
    "align_bpmn_elements",
    "distribute_bpmn_elements",
    "set_input_output_mapping",
    "set_event_definition",
    "set_form_data",
    "layout_diagram",
    "set_camunda_error_event_definition",
    "set_loop_characteristics",
  ])("includes tool '%s'", (name) => {
    expect(toolNames).toContain(name);
  });

  it("every tool has an inputSchema with type 'object'", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("add_bpmn_element requires diagramId and elementType", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "add_bpmn_element");
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(["diagramId", "elementType"]),
    );
  });

  it("add_bpmn_element enum includes BoundaryEvent and CallActivity", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "add_bpmn_element");
    const enumValues = (tool?.inputSchema.properties as any).elementType.enum;
    expect(enumValues).toContain("bpmn:BoundaryEvent");
    expect(enumValues).toContain("bpmn:CallActivity");
    expect(enumValues).toContain("bpmn:TextAnnotation");
  });

  it("export_bpmn requires diagramId and format", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "export_bpmn");
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(["diagramId", "format"]),
    );
    const props = tool?.inputSchema.properties as any;
    expect(props.format.enum).toEqual(["xml", "svg"]);
  });

  it("connect_bpmn_elements has connectionType and conditionExpression params", () => {
    const tool = TOOL_DEFINITIONS.find(
      (t) => t.name === "connect_bpmn_elements",
    );
    const props = tool?.inputSchema.properties as any;
    expect(props.connectionType).toBeDefined();
    expect(props.conditionExpression).toBeDefined();
  });

  it("align_bpmn_elements requires elementIds and alignment", () => {
    const tool = TOOL_DEFINITIONS.find(
      (t) => t.name === "align_bpmn_elements",
    );
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(["diagramId", "elementIds", "alignment"]),
    );
  });

  it("set_input_output_mapping has inputParameters and outputParameters but not source", () => {
    const tool = TOOL_DEFINITIONS.find(
      (t) => t.name === "set_input_output_mapping",
    );
    const props = tool?.inputSchema.properties as any;
    expect(props.inputParameters).toBeDefined();
    expect(props.outputParameters).toBeDefined();
    // source and sourceExpression should have been removed
    const inputItemProps = props.inputParameters.items.properties;
    expect(inputItemProps.source).toBeUndefined();
    expect(inputItemProps.sourceExpression).toBeUndefined();
  });

  it("set_event_definition requires eventDefinitionType", () => {
    const tool = TOOL_DEFINITIONS.find(
      (t) => t.name === "set_event_definition",
    );
    expect(tool?.inputSchema.required).toContain("eventDefinitionType");
  });

  it("set_form_data requires fields", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "set_form_data");
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(["diagramId", "elementId", "fields"]),
    );
  });

  it("align_bpmn_elements has compact parameter", () => {
    const tool = TOOL_DEFINITIONS.find(
      (t) => t.name === "align_bpmn_elements",
    );
    const props = tool?.inputSchema.properties as any;
    expect(props.compact).toBeDefined();
    expect(props.compact.type).toBe("boolean");
  });

  it("distribute_bpmn_elements has gap parameter", () => {
    const tool = TOOL_DEFINITIONS.find(
      (t) => t.name === "distribute_bpmn_elements",
    );
    const props = tool?.inputSchema.properties as any;
    expect(props.gap).toBeDefined();
    expect(props.gap.type).toBe("number");
  });

  it("connect_bpmn_elements has isDefault parameter", () => {
    const tool = TOOL_DEFINITIONS.find(
      (t) => t.name === "connect_bpmn_elements",
    );
    const props = tool?.inputSchema.properties as any;
    expect(props.isDefault).toBeDefined();
    expect(props.isDefault.type).toBe("boolean");
  });

  it("add_bpmn_element enum includes Participant and Lane", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "add_bpmn_element");
    const enumValues = (tool?.inputSchema.properties as any).elementType.enum;
    expect(enumValues).toContain("bpmn:Participant");
    expect(enumValues).toContain("bpmn:Lane");
  });

  it("layout_diagram requires diagramId", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "layout_diagram");
    expect(tool?.inputSchema.required).toContain("diagramId");
  });

  it("set_camunda_error_event_definition requires errorDefinitions", () => {
    const tool = TOOL_DEFINITIONS.find(
      (t) => t.name === "set_camunda_error_event_definition",
    );
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(["diagramId", "elementId", "errorDefinitions"]),
    );
  });

  it("set_loop_characteristics requires loopType", () => {
    const tool = TOOL_DEFINITIONS.find(
      (t) => t.name === "set_loop_characteristics",
    );
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(["diagramId", "elementId", "loopType"]),
    );
  });
});
