/**
 * Barrel re-export of all handler functions + dispatch map.
 *
 * Individual handler modules live in src/handlers/<name>.ts.
 */

import { type ToolResult } from "../types";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { handleCreateDiagram } from "./create-diagram";
import { handleAddElement } from "./add-element";
import { handleConnect } from "./connect";
import { handleDeleteElement } from "./delete-element";
import { handleMoveElement } from "./move-element";
import { handleGetProperties } from "./get-properties";
import { handleExportBpmn } from "./export";

/** @deprecated Use handleExportBpmn with format: "xml" */
const handleExportXml = (args: any) => handleExportBpmn({ ...args, format: "xml" });
/** @deprecated Use handleExportBpmn with format: "svg" */
const handleExportSvg = (args: any) => handleExportBpmn({ ...args, format: "svg" });
import { handleListElements } from "./list-elements";
import { handleSetProperties } from "./set-properties";
import { handleImportXml } from "./import-xml";
import { handleDeleteDiagram } from "./delete-diagram";
import { handleListDiagrams } from "./list-diagrams";
import { handleCloneDiagram } from "./clone-diagram";
import { handleValidate } from "./validate";
import { handleAlignElements } from "./align-elements";
import { handleDistributeElements } from "./distribute-elements";
import { handleSetInputOutput } from "./set-input-output";
import { handleSetEventDefinition } from "./set-event-definition";
import { handleSetFormData } from "./set-form-data";
import { handleLayoutDiagram } from "./layout-diagram";
import { handleSetCamundaErrorEventDefinition } from "./set-camunda-error";
import { handleSetLoopCharacteristics } from "./set-loop-characteristics";
import { handleLintDiagram } from "./lint";
import { handleAdjustLabels } from "./adjust-labels-handler";

// Re-export every handler so existing imports keep working
export {
  handleCreateDiagram,
  handleAddElement,
  handleConnect,
  handleDeleteElement,
  handleMoveElement,
  handleGetProperties,
  handleExportBpmn,
  handleExportXml,
  handleExportSvg,
  handleListElements,
  handleSetProperties,
  handleImportXml,
  handleDeleteDiagram,
  handleListDiagrams,
  handleCloneDiagram,
  handleValidate,
  handleAlignElements,
  handleDistributeElements,
  handleSetInputOutput,
  handleSetEventDefinition,
  handleSetFormData,
  handleLayoutDiagram,
  handleSetCamundaErrorEventDefinition,
  handleSetLoopCharacteristics,
  handleLintDiagram,
  handleAdjustLabels,
};

// ── Dispatch map ───────────────────────────────────────────────────────────
//
// Naming convention:
//   - Core structural BPMN tools use `bpmn_` infix (add_bpmn_element, etc.)
//   - Camunda-specific tools use `set_` / `camunda_` prefixes
//   - Utility tools (clone, delete, layout, validate) use a flat namespace
//   - Backward-compat aliases (auto_layout, export_bpmn_xml/svg) are kept
//     in the dispatch map for existing callers.

const handlers: Record<string, (args: any) => Promise<ToolResult>> = {
  create_bpmn_diagram: handleCreateDiagram,
  add_bpmn_element: handleAddElement,
  connect_bpmn_elements: handleConnect,
  delete_bpmn_element: handleDeleteElement,
  move_bpmn_element: handleMoveElement,
  get_element_properties: handleGetProperties,
  export_bpmn: handleExportBpmn,
  export_bpmn_xml: (args: any) => handleExportBpmn({ ...args, format: "xml" }),
  export_bpmn_svg: (args: any) => handleExportBpmn({ ...args, format: "svg" }),
  list_bpmn_elements: handleListElements,
  set_element_properties: handleSetProperties,
  import_bpmn_xml: handleImportXml,
  delete_diagram: handleDeleteDiagram,
  list_diagrams: handleListDiagrams,
  clone_diagram: handleCloneDiagram,
  validate_bpmn_diagram: handleValidate,
  align_bpmn_elements: handleAlignElements,
  distribute_bpmn_elements: handleDistributeElements,
  set_input_output_mapping: handleSetInputOutput,
  set_event_definition: handleSetEventDefinition,
  set_form_data: handleSetFormData,
  layout_diagram: handleLayoutDiagram,
  auto_layout: handleLayoutDiagram, // backward compat alias
  set_camunda_error_event_definition: handleSetCamundaErrorEventDefinition,
  set_loop_characteristics: handleSetLoopCharacteristics,
  lint_bpmn_diagram: handleLintDiagram,
  adjust_labels: handleAdjustLabels,
};

/** Route a CallTool request to the correct handler. */
export async function dispatchToolCall(
  name: string,
  args: any,
): Promise<ToolResult> {
  const handler = handlers[name];
  if (!handler) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  try {
    return await handler(args);
  } catch (error: any) {
    if (error instanceof McpError) throw error;
    throw new McpError(
      ErrorCode.InternalError,
      `Error executing ${name}: ${error.message}`,
    );
  }
}
