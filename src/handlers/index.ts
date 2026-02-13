/**
 * Barrel re-export of all handler functions + unified tool registry.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  ADDING A NEW TOOL? Only TWO steps needed:                      │
 * │  1. Create src/handlers/<category>/<name>.ts                    │
 * │     (export handler + TOOL_DEFINITION)                          │
 * │  2. Add ONE entry to TOOL_REGISTRY below                        │
 * │                                                                  │
 * │  Categories: core/, elements/, properties/, layout/,            │
 * │              collaboration/                                      │
 * │  The dispatch map and TOOL_DEFINITIONS array are auto-derived.  │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ERR_INTERNAL } from '../errors';

// ── Core: diagram lifecycle, import/export, validation, batch ──────────────

import { handleCreateDiagram, TOOL_DEFINITION as CREATE_DIAGRAM_DEF } from './core/create-diagram';
import { handleDeleteDiagram, TOOL_DEFINITION as DELETE_DIAGRAM_DEF } from './core/delete-diagram';
import { handleCloneDiagram, TOOL_DEFINITION as CLONE_DIAGRAM_DEF } from './core/clone-diagram';
import { handleListDiagrams, TOOL_DEFINITION as LIST_DIAGRAMS_DEF } from './core/list-diagrams';
import {
  handleSummarizeDiagram,
  TOOL_DEFINITION as SUMMARIZE_DIAGRAM_DEF,
} from './core/summarize-diagram';
import { handleImportXml, TOOL_DEFINITION as IMPORT_XML_DEF } from './core/import-xml';
import { handleExportBpmn, TOOL_DEFINITION as EXPORT_BPMN_DEF } from './core/export';
import { handleValidate, TOOL_DEFINITION as VALIDATE_DEF } from './core/validate';
import {
  handleBatchOperations,
  TOOL_DEFINITION as BATCH_OPERATIONS_DEF,
} from './core/batch-operations';
import {
  handleBpmnHistory,
  handleUndoChange,
  handleRedoChange,
  TOOL_DEFINITION as BPMN_HISTORY_DEF,
} from './core/bpmn-history';
import { handleDiffDiagrams, TOOL_DEFINITION as DIFF_DIAGRAMS_DEF } from './core/diff-diagrams';
import {
  handleListProcessVariables,
  TOOL_DEFINITION as LIST_PROCESS_VARIABLES_DEF,
} from './core/list-process-variables';

// ── Elements: element CRUD operations ──────────────────────────────────────

import { handleAddElement, TOOL_DEFINITION as ADD_ELEMENT_DEF } from './elements/add-element';
import {
  handleConnect,
  handleAutoConnect,
  handleCreateDataAssociation,
  TOOL_DEFINITION as CONNECT_DEF,
} from './elements/connect';
import {
  handleDeleteElement,
  TOOL_DEFINITION as DELETE_ELEMENT_DEF,
} from './elements/delete-element';
import {
  handleMoveElement,
  handleMoveToLane,
  TOOL_DEFINITION as MOVE_ELEMENT_DEF,
} from './elements/move-element';
import {
  handleDuplicateElement,
  TOOL_DEFINITION as DUPLICATE_ELEMENT_DEF,
} from './elements/duplicate-element';
import {
  handleInsertElement,
  TOOL_DEFINITION as INSERT_ELEMENT_DEF,
} from './elements/insert-element';
import {
  handleReplaceElement,
  TOOL_DEFINITION as REPLACE_ELEMENT_DEF,
} from './elements/replace-element';
import { handleListElements, TOOL_DEFINITION as LIST_ELEMENTS_DEF } from './elements/list-elements';
import {
  handleGetProperties,
  TOOL_DEFINITION as GET_PROPERTIES_DEF,
} from './elements/get-properties';

// ── Properties: property setters ───────────────────────────────────────────

import {
  handleSetProperties,
  TOOL_DEFINITION as SET_PROPERTIES_DEF,
} from './properties/set-properties';
import {
  handleSetInputOutput,
  TOOL_DEFINITION as SET_INPUT_OUTPUT_DEF,
} from './properties/set-input-output';
import {
  handleSetEventDefinition,
  TOOL_DEFINITION as SET_EVENT_DEFINITION_DEF,
} from './properties/set-event-definition';
import {
  handleSetFormData,
  TOOL_DEFINITION as SET_FORM_DATA_DEF,
} from './properties/set-form-data';
import {
  handleSetLoopCharacteristics,
  TOOL_DEFINITION as SET_LOOP_CHARACTERISTICS_DEF,
} from './properties/set-loop-characteristics';
import { handleSetScript, TOOL_DEFINITION as SET_SCRIPT_DEF } from './properties/set-script';
import {
  handleSetCamundaListeners,
  TOOL_DEFINITION as SET_CAMUNDA_LISTENERS_DEF,
} from './properties/set-camunda-listeners';
import {
  handleSetCallActivityVariables,
  TOOL_DEFINITION as SET_CALL_ACTIVITY_VARIABLES_DEF,
} from './properties/set-call-activity-variables';

// ── Layout: layout, alignment, label adjustment ────────────────────────────

import {
  handleLayoutDiagram,
  TOOL_DEFINITION as LAYOUT_DIAGRAM_DEF,
} from './layout/layout-diagram';
import {
  handleAlignElements,
  TOOL_DEFINITION as ALIGN_ELEMENTS_DEF,
} from './layout/align-elements';
import {
  handleAdjustLabels,
  TOOL_DEFINITION as ADJUST_LABELS_DEF,
} from './layout/labels/adjust-labels-handler';

// ── Collaboration: pools, root elements ────────────────────────────────────

import {
  handleCreateCollaboration,
  TOOL_DEFINITION as CREATE_COLLABORATION_DEF,
} from './collaboration/create-collaboration';
import {
  handleManageRootElements,
  TOOL_DEFINITION as MANAGE_ROOT_ELEMENTS_DEF,
} from './collaboration/manage-root-elements';
import {
  handleCreateLanes,
  TOOL_DEFINITION as CREATE_LANES_DEF,
} from './collaboration/create-lanes';
import {
  handleAssignElementsToLane,
  TOOL_DEFINITION as ASSIGN_ELEMENTS_TO_LANE_DEF,
} from './collaboration/assign-elements-to-lane';
import {
  handleWrapProcessInCollaboration,
  TOOL_DEFINITION as WRAP_PROCESS_IN_COLLABORATION_DEF,
} from './collaboration/wrap-process-in-collaboration';

// ── Unified tool registry ──────────────────────────────────────────────────
//
// Single source of truth: each entry pairs a TOOL_DEFINITION with its handler.
// Both TOOL_DEFINITIONS and the dispatch map are auto-derived from this array.

interface ToolRegistration {
  readonly definition: { readonly name: string; readonly [key: string]: unknown };
  readonly handler: (args: any) => Promise<ToolResult>;
}

const TOOL_REGISTRY: ToolRegistration[] = [
  { definition: CREATE_DIAGRAM_DEF, handler: handleCreateDiagram },
  { definition: ADD_ELEMENT_DEF, handler: handleAddElement },
  { definition: CONNECT_DEF, handler: handleConnect },
  { definition: DELETE_ELEMENT_DEF, handler: handleDeleteElement },
  { definition: MOVE_ELEMENT_DEF, handler: handleMoveElement },
  { definition: GET_PROPERTIES_DEF, handler: handleGetProperties },
  { definition: EXPORT_BPMN_DEF, handler: handleExportBpmn },
  { definition: LIST_ELEMENTS_DEF, handler: handleListElements },
  { definition: SET_PROPERTIES_DEF, handler: handleSetProperties },
  { definition: IMPORT_XML_DEF, handler: handleImportXml },
  { definition: DELETE_DIAGRAM_DEF, handler: handleDeleteDiagram },
  { definition: LIST_DIAGRAMS_DEF, handler: handleListDiagrams },
  { definition: CLONE_DIAGRAM_DEF, handler: handleCloneDiagram },
  { definition: VALIDATE_DEF, handler: handleValidate },
  { definition: ALIGN_ELEMENTS_DEF, handler: handleAlignElements },
  { definition: SET_INPUT_OUTPUT_DEF, handler: handleSetInputOutput },
  { definition: SET_EVENT_DEFINITION_DEF, handler: handleSetEventDefinition },
  { definition: SET_FORM_DATA_DEF, handler: handleSetFormData },
  { definition: LAYOUT_DIAGRAM_DEF, handler: handleLayoutDiagram },
  { definition: SET_LOOP_CHARACTERISTICS_DEF, handler: handleSetLoopCharacteristics },
  { definition: ADJUST_LABELS_DEF, handler: handleAdjustLabels },
  { definition: SET_SCRIPT_DEF, handler: handleSetScript },
  { definition: CREATE_COLLABORATION_DEF, handler: handleCreateCollaboration },
  { definition: BPMN_HISTORY_DEF, handler: handleBpmnHistory },
  { definition: DIFF_DIAGRAMS_DEF, handler: handleDiffDiagrams },
  { definition: BATCH_OPERATIONS_DEF, handler: handleBatchOperations },
  { definition: SET_CAMUNDA_LISTENERS_DEF, handler: handleSetCamundaListeners },
  { definition: SET_CALL_ACTIVITY_VARIABLES_DEF, handler: handleSetCallActivityVariables },
  { definition: MANAGE_ROOT_ELEMENTS_DEF, handler: handleManageRootElements },
  { definition: CREATE_LANES_DEF, handler: handleCreateLanes },
  { definition: ASSIGN_ELEMENTS_TO_LANE_DEF, handler: handleAssignElementsToLane },
  { definition: WRAP_PROCESS_IN_COLLABORATION_DEF, handler: handleWrapProcessInCollaboration },
  { definition: DUPLICATE_ELEMENT_DEF, handler: handleDuplicateElement },
  { definition: INSERT_ELEMENT_DEF, handler: handleInsertElement },
  { definition: REPLACE_ELEMENT_DEF, handler: handleReplaceElement },
  { definition: SUMMARIZE_DIAGRAM_DEF, handler: handleSummarizeDiagram },
  { definition: LIST_PROCESS_VARIABLES_DEF, handler: handleListProcessVariables },
];

// ── Auto-derived exports ───────────────────────────────────────────────────

/** MCP tool definitions (passed to ListTools). */
export const TOOL_DEFINITIONS = TOOL_REGISTRY.map((r) => r.definition);

/** Dispatch map: tool-name → handler. Auto-derived from TOOL_REGISTRY. */
const dispatchMap: Record<string, (args: any) => Promise<ToolResult>> = {};
for (const { definition, handler } of TOOL_REGISTRY) {
  dispatchMap[definition.name] = handler;
}

/** Route a CallTool request to the correct handler. */
export async function dispatchToolCall(name: string, args: any): Promise<ToolResult> {
  const handler = dispatchMap[name];
  if (!handler) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  try {
    return await handler(args);
  } catch (error: any) {
    if (error instanceof McpError) throw error;
    throw new McpError(ErrorCode.InternalError, `Error executing ${name}: ${error.message}`, {
      code: ERR_INTERNAL,
    });
  }
}

// ── Re-export every handler so existing imports keep working ───────────────

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
  handleSetInputOutput,
  handleSetEventDefinition,
  handleSetFormData,
  handleLayoutDiagram,
  handleSetLoopCharacteristics,
  handleAdjustLabels,
  handleSetScript,
  handleCreateCollaboration,
  handleCreateLanes,
  handleAssignElementsToLane,
  handleWrapProcessInCollaboration,
  handleBpmnHistory,
  handleUndoChange,
  handleRedoChange,
  handleDiffDiagrams,
  handleBatchOperations,
  handleSetCamundaListeners,
  handleSetCallActivityVariables,
  handleManageRootElements,
  handleDuplicateElement,
  handleInsertElement,
  handleReplaceElement,
  handleSummarizeDiagram,
  handleListProcessVariables,
};

// Backward-compat aliases for removed tool names
const handleLintDiagram = handleValidate;
const handleSearchElements = handleListElements;
const handleExportSubprocess = handleExportBpmn;
export { handleLintDiagram, handleSearchElements, handleExportSubprocess };
