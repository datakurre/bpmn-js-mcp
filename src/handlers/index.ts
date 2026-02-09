/**
 * Barrel re-export of all handler functions + dispatch map.
 *
 * Individual handler modules live in src/handlers/<name>.ts.
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { handleCreateDiagram } from './create-diagram';
import { handleAddElement } from './add-element';
import { handleConnect, handleAutoConnect, handleCreateDataAssociation } from './connect';
import { handleDeleteElement } from './delete-element';
import { handleMoveElement, handleMoveToLane } from './move-element';
import { handleGetProperties } from './get-properties';
import { handleExportBpmn } from './export';
import { handleListElements } from './list-elements';
import { handleSetProperties } from './set-properties';
import { handleImportXml } from './import-xml';
import { handleDeleteDiagram } from './delete-diagram';
import { handleListDiagrams } from './list-diagrams';
import { handleCloneDiagram } from './clone-diagram';
import { handleValidate } from './validate';
import { handleAlignElements } from './align-elements';
import { handleDistributeElements } from './distribute-elements';
import { handleSetInputOutput } from './set-input-output';
import { handleSetEventDefinition } from './set-event-definition';
import { handleSetFormData } from './set-form-data';
import { handleLayoutDiagram } from './layout-diagram';
import { handleSetCamundaErrorEventDefinition } from './set-camunda-error';
import { handleSetLoopCharacteristics } from './set-loop-characteristics';
import { handleAdjustLabels } from './adjust-labels-handler';
import { handleSetScript } from './set-script';
import { handleCreateCollaboration } from './create-collaboration';
import { handleBpmnHistory, handleUndoChange, handleRedoChange } from './undo';
import { handleDiffDiagrams } from './diff-diagrams';
import { handleBatchOperations } from './batch-operations';
import { handleResizeElement } from './resize-element';
import { handleSetCamundaListeners } from './set-camunda-listeners';
import { handleSetCallActivityVariables } from './set-call-activity-variables';
import { handleManageRootElements } from './manage-root-elements';
import { handleDuplicateElement } from './duplicate-element';
import { handleInsertElement } from './insert-element';
import { handleReplaceElement } from './replace-element';
import { handleSummarizeDiagram } from './summarize-diagram';

// Re-export every handler so existing imports keep working
export {
  handleCreateDiagram,
  handleAddElement,
  handleConnect,
  handleAutoConnect,
  handleCreateDataAssociation,
  handleDeleteElement,
  handleMoveElement,
  handleMoveToLane,
  handleGetProperties,
  handleExportBpmn,
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
  handleAdjustLabels,
  handleSetScript,
  handleCreateCollaboration,
  handleBpmnHistory,
  handleUndoChange,
  handleRedoChange,
  handleDiffDiagrams,
  handleBatchOperations,
  handleResizeElement,
  handleSetCamundaListeners,
  handleSetCallActivityVariables,
  handleManageRootElements,
  handleDuplicateElement,
  handleInsertElement,
  handleReplaceElement,
  handleSummarizeDiagram,
};

// Backward-compat aliases for removed tool names
const handleLintDiagram = handleValidate;
const handleSearchElements = handleListElements;
const handleExportSubprocess = handleExportBpmn;
export { handleLintDiagram, handleSearchElements, handleExportSubprocess };

// ── Dispatch map ───────────────────────────────────────────────────────────
//
// Every tool name includes "bpmn" to avoid clashes with other MCPs.

const handlers: Record<string, (args: any) => Promise<ToolResult>> = {
  create_bpmn_diagram: handleCreateDiagram,
  add_bpmn_element: handleAddElement,
  connect_bpmn_elements: handleConnect,
  delete_bpmn_element: handleDeleteElement,
  move_bpmn_element: handleMoveElement,
  get_bpmn_element_properties: handleGetProperties,
  set_bpmn_element_properties: handleSetProperties,
  export_bpmn: handleExportBpmn,
  import_bpmn_xml: handleImportXml,
  list_bpmn_elements: handleListElements,
  delete_bpmn_diagram: handleDeleteDiagram,
  list_bpmn_diagrams: handleListDiagrams,
  clone_bpmn_diagram: handleCloneDiagram,
  validate_bpmn_diagram: handleValidate,
  align_bpmn_elements: handleAlignElements,
  distribute_bpmn_elements: handleDistributeElements,
  layout_bpmn_diagram: handleLayoutDiagram,
  adjust_bpmn_labels: handleAdjustLabels,
  set_bpmn_input_output_mapping: handleSetInputOutput,
  set_bpmn_event_definition: handleSetEventDefinition,
  set_bpmn_form_data: handleSetFormData,
  set_bpmn_camunda_error: handleSetCamundaErrorEventDefinition,
  set_bpmn_loop_characteristics: handleSetLoopCharacteristics,
  set_bpmn_script: handleSetScript,
  create_bpmn_collaboration: handleCreateCollaboration,
  bpmn_history: handleBpmnHistory,
  diff_bpmn_diagrams: handleDiffDiagrams,
  batch_bpmn_operations: handleBatchOperations,
  resize_bpmn_element: handleResizeElement,
  set_bpmn_camunda_listeners: handleSetCamundaListeners,
  set_bpmn_call_activity_variables: handleSetCallActivityVariables,
  manage_bpmn_root_elements: handleManageRootElements,
  duplicate_bpmn_element: handleDuplicateElement,
  insert_bpmn_element: handleInsertElement,
  replace_bpmn_element: handleReplaceElement,
  summarize_bpmn_diagram: handleSummarizeDiagram,
};

/** Route a CallTool request to the correct handler. */
export async function dispatchToolCall(name: string, args: any): Promise<ToolResult> {
  const handler = handlers[name];
  if (!handler) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  try {
    return await handler(args);
  } catch (error: any) {
    if (error instanceof McpError) throw error;
    throw new McpError(ErrorCode.InternalError, `Error executing ${name}: ${error.message}`);
  }
}
