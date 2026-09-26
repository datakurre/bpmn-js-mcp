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

import { type ToolResult, type ToolContext } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ERR_INTERNAL } from '../errors';

// ── Core: diagram lifecycle, import/export, validation, batch ──────────────

import { handleCreateDiagram, TOOL_DEFINITION as CREATE_DIAGRAM_DEF } from './core/create-diagram';
import { handleDeleteDiagram, TOOL_DEFINITION as DELETE_DIAGRAM_DEF } from './core/delete-diagram';
import { handleCloneDiagram } from './core/clone-diagram';
import { handleListDiagrams, TOOL_DEFINITION as LIST_DIAGRAMS_DEF } from './core/list-diagrams';
import { handleSummarizeDiagram } from './core/summarize-diagram';
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
import { handleDiffDiagrams } from './core/diff-diagrams';
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
import { handleDuplicateElement } from './elements/duplicate-element';
import { handleInsertElement } from './elements/insert-element';
import { handleReplaceElement } from './elements/replace-element';
import {
  handleAddElementChain,
  TOOL_DEFINITION as ADD_ELEMENT_CHAIN_DEF,
} from './elements/add-element-chain';
import { handleListElements, TOOL_DEFINITION as LIST_ELEMENTS_DEF } from './elements/list-elements';
import {
  handleGetProperties,
  TOOL_DEFINITION as GET_PROPERTIES_DEF,
} from './elements/get-properties';
import { handleSetConnectionWaypoints } from './elements/set-connection-waypoints';

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
import { handleSetScript } from './properties/set-script';
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
import { handleAdjustLabels } from './layout/labels/adjust-labels-handler';

// ── Collaboration: pools, root elements ────────────────────────────────────

import { handleCreateCollaboration } from './collaboration/create-collaboration';
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
import { handleWrapProcessInCollaboration } from './collaboration/wrap-process-in-collaboration';
import { handleSplitParticipantIntoLanes } from './collaboration/split-participant-into-lanes';
import {
  handleCreateParticipant,
  TOOL_DEFINITION as CREATE_PARTICIPANT_DEF,
} from './collaboration/create-participant';
import { handleHandoffToLane } from './collaboration/handoff-to-lane';
import {
  handleSuggestLaneOrganization,
  handleValidateLaneOrganization,
  handleSuggestPoolVsLanes,
  handleAnalyzeLanes,
  TOOL_DEFINITION as ANALYZE_LANES_DEF,
} from './collaboration/analyze-lanes';
import { handleConvertCollaborationToLanes } from './collaboration/convert-collaboration-to-lanes';
import { handleRedistributeElementsAcrossLanes } from './collaboration/redistribute-elements-across-lanes';
import { handleAutosizePoolsAndLanes } from './collaboration/autosize-pools-and-lanes';

// ── Unified tool registry ──────────────────────────────────────────────────
//
// Single source of truth: each entry pairs a TOOL_DEFINITION with its handler.
// Both TOOL_DEFINITIONS and the dispatch map are auto-derived from this array.

interface ToolRegistration {
  readonly definition: { readonly name: string; readonly [key: string]: unknown };
  readonly handler: (args: any, context?: ToolContext) => Promise<ToolResult>;
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
  { definition: VALIDATE_DEF, handler: handleValidate },
  { definition: ALIGN_ELEMENTS_DEF, handler: handleAlignElements },
  { definition: SET_INPUT_OUTPUT_DEF, handler: handleSetInputOutput },
  { definition: SET_EVENT_DEFINITION_DEF, handler: handleSetEventDefinition },
  { definition: SET_FORM_DATA_DEF, handler: handleSetFormData },
  { definition: LAYOUT_DIAGRAM_DEF, handler: handleLayoutDiagram },
  { definition: SET_LOOP_CHARACTERISTICS_DEF, handler: handleSetLoopCharacteristics },
  { definition: BPMN_HISTORY_DEF, handler: handleBpmnHistory },
  { definition: BATCH_OPERATIONS_DEF, handler: handleBatchOperations },
  { definition: SET_CAMUNDA_LISTENERS_DEF, handler: handleSetCamundaListeners },
  { definition: SET_CALL_ACTIVITY_VARIABLES_DEF, handler: handleSetCallActivityVariables },
  { definition: MANAGE_ROOT_ELEMENTS_DEF, handler: handleManageRootElements },
  { definition: CREATE_LANES_DEF, handler: handleCreateLanes },
  { definition: CREATE_PARTICIPANT_DEF, handler: handleCreateParticipant },
  { definition: ANALYZE_LANES_DEF, handler: handleAnalyzeLanes },
  // redistribute_bpmn_elements_across_lanes removed: redistribute mode on analyze_bpmn_lanes
  // replace_bpmn_element removed: elementType parameter on set_bpmn_element_properties
  { definition: LIST_PROCESS_VARIABLES_DEF, handler: handleListProcessVariables },
  // clone_bpmn_diagram removed: cloneFrom parameter on create_bpmn_diagram
  // diff_bpmn_diagrams removed: compareWith parameter on list_bpmn_diagrams
  { definition: ADD_ELEMENT_CHAIN_DEF, handler: handleAddElementChain },
  // set_bpmn_connection_waypoints removed: waypoints+connectionId parameters on connect_bpmn_elements
  { definition: ASSIGN_ELEMENTS_TO_LANE_DEF, handler: handleAssignElementsToLane },
  // wrap_bpmn_process_in_collaboration removed: wrapExisting on create_bpmn_participant
  // handoff_bpmn_to_lane removed: fromElementId + toLaneId params on add_bpmn_element
  // convert_bpmn_collaboration_to_lanes removed: mergeFrom on create_bpmn_lanes
  // autosize_bpmn_pools_and_lanes removed: autosizeOnly on layout_bpmn_diagram
];

// ── Auto-derived exports ───────────────────────────────────────────────────

/**
 * Tools that only read diagram state — no idempotency caching needed.
 * Derived from handler files tagged `// @readonly`.
 */
const READONLY_TOOLS = new Set([
  'export_bpmn',
  'list_bpmn_diagrams',
  'list_bpmn_process_variables',
  'validate_bpmn_diagram',
  'list_bpmn_elements',
  'get_bpmn_element_properties',
  'analyze_bpmn_lanes',
]);

/** Tools whose primary effect is permanently removing a diagram or element. */
const DESTRUCTIVE_TOOLS = new Set(['delete_bpmn_diagram', 'delete_bpmn_element']);

/**
 * Tools that read or write local files (via `filePath`), so they interact
 * with something outside the in-memory diagram model.
 */
const OPEN_WORLD_TOOLS = new Set(['import_bpmn_xml', 'export_bpmn']);

/**
 * Tools where repeating an identical call has no additional effect beyond
 * the first — setting the same properties, moving to the same position, or
 * deleting an already-deleted target. Excludes tools that create new
 * elements/diagrams/connections, where a repeat call duplicates state.
 */
const IDEMPOTENT_TOOLS = new Set([
  'set_bpmn_element_properties',
  'set_bpmn_input_output_mapping',
  'set_bpmn_event_definition',
  'set_bpmn_form_data',
  'set_bpmn_loop_characteristics',
  'set_bpmn_camunda_listeners',
  'set_bpmn_call_activity_variables',
  'move_bpmn_element',
  'align_bpmn_elements',
  'layout_bpmn_diagram',
  'manage_bpmn_root_elements',
  'delete_bpmn_element',
  'delete_bpmn_diagram',
]);

/** Short human-readable title per tool, for clients that label/group tools. */
const TOOL_TITLES: Record<string, string> = {
  create_bpmn_diagram: 'Create Diagram',
  add_bpmn_element: 'Add Element',
  connect_bpmn_elements: 'Connect Elements',
  delete_bpmn_element: 'Delete Element',
  move_bpmn_element: 'Move/Resize Element',
  get_bpmn_element_properties: 'Get Element Properties',
  export_bpmn: 'Export Diagram',
  list_bpmn_elements: 'List Elements',
  set_bpmn_element_properties: 'Set Element Properties',
  import_bpmn_xml: 'Import Diagram',
  delete_bpmn_diagram: 'Delete Diagram',
  list_bpmn_diagrams: 'List Diagrams',
  validate_bpmn_diagram: 'Validate Diagram',
  align_bpmn_elements: 'Align/Distribute Elements',
  set_bpmn_input_output_mapping: 'Set Input/Output Mapping',
  set_bpmn_event_definition: 'Set Event Definition',
  set_bpmn_form_data: 'Set Form Data',
  layout_bpmn_diagram: 'Auto-Layout Diagram',
  set_bpmn_loop_characteristics: 'Set Loop Characteristics',
  bpmn_history: 'Diagram History (Undo/Redo)',
  batch_bpmn_operations: 'Batch Operations',
  set_bpmn_camunda_listeners: 'Set Camunda Listeners',
  set_bpmn_call_activity_variables: 'Set Call Activity Variables',
  manage_bpmn_root_elements: 'Manage Root Elements',
  create_bpmn_lanes: 'Create Lanes',
  create_bpmn_participant: 'Create Participant/Pool',
  analyze_bpmn_lanes: 'Analyze Lanes',
  list_bpmn_process_variables: 'List Process Variables',
  add_bpmn_element_chain: 'Add Element Chain',
  assign_bpmn_elements_to_lane: 'Assign Elements to Lane',
};

/** Build the MCP `annotations` object for a tool (see MCP spec ToolAnnotations). */
function buildAnnotations(name: string): Record<string, unknown> {
  return {
    title: TOOL_TITLES[name] ?? name,
    readOnlyHint: READONLY_TOOLS.has(name),
    ...(DESTRUCTIVE_TOOLS.has(name) ? { destructiveHint: true } : {}),
    ...(IDEMPOTENT_TOOLS.has(name) ? { idempotentHint: true } : {}),
    openWorldHint: OPEN_WORLD_TOOLS.has(name),
  };
}

/**
 * MCP tool definitions (passed to ListTools).
 *
 * Every tool is augmented with `annotations` (title, readOnlyHint,
 * destructiveHint, idempotentHint, openWorldHint) so clients can auto-approve
 * read-only calls and group or hide tools without parsing descriptions.
 *
 * Every mutating tool also accepts an optional `_clientRequestId` string for
 * idempotent retry (see `dispatchToolCall` below), advertised once in the
 * server's top-level `instructions` (src/index.ts) rather than repeated in
 * every tool's schema — at ~190 characters each, doing so across ~22 tools
 * added roughly 5 KB to the tool list every session pays for.
 */
export const TOOL_DEFINITIONS: Array<{ name: string; [key: string]: unknown }> = TOOL_REGISTRY.map(
  (r) => ({ ...r.definition, annotations: buildAnnotations(r.definition.name as string) })
);

// ── Idempotency cache ──────────────────────────────────────────────────────

/**
 * Bounded cache mapping `_clientRequestId` → `ToolResult` for safe retries.
 *
 * Entries are evicted FIFO once the cache exceeds `MAX_IDEMPOTENCY_CACHE`.
 * Only mutating tools participate; read-only tools are always re-executed.
 */
const MAX_IDEMPOTENCY_CACHE = 1000;
const idempotencyCache = new Map<string, ToolResult>();

/** Clear the idempotency cache (exposed for tests). */
export function clearIdempotencyCache(): void {
  idempotencyCache.clear();
}

/** Dispatch map: tool-name → handler. Auto-derived from TOOL_REGISTRY. */
const dispatchMap: Record<string, (args: any, context?: ToolContext) => Promise<ToolResult>> = {};
for (const { definition, handler } of TOOL_REGISTRY) {
  dispatchMap[definition.name] = handler;
}

/**
 * Route a CallTool request to the correct handler.
 *
 * For mutating tools, supports idempotent retry via `_clientRequestId`:
 * if the same ID is seen again the cached result is returned immediately.
 *
 * @param context  Optional execution context (progress notifications, etc.)
 */
export async function dispatchToolCall(
  name: string,
  args: any,
  context?: ToolContext
): Promise<ToolResult> {
  const handler = dispatchMap[name];
  if (!handler) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  // Idempotency: check cache for mutating tools with a client request ID
  const clientRequestId: string | undefined = args?._clientRequestId;
  const isMutating = !READONLY_TOOLS.has(name);

  if (clientRequestId && isMutating) {
    const cached = idempotencyCache.get(clientRequestId);
    if (cached) return cached;
  }

  // Strip _clientRequestId before passing to the handler
  let cleanArgs = args;
  if (clientRequestId) {
    cleanArgs = { ...args };
    delete cleanArgs._clientRequestId;
  }

  try {
    const result = await handler(cleanArgs, context);

    // Cache result for idempotent retries
    if (clientRequestId && isMutating) {
      if (idempotencyCache.size >= MAX_IDEMPOTENCY_CACHE) {
        // Evict oldest entry (FIFO — Map iterates in insertion order)
        const oldest = idempotencyCache.keys().next().value;
        if (oldest !== undefined) idempotencyCache.delete(oldest);
      }
      idempotencyCache.set(clientRequestId, result);
    }

    return result;
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
  handleSplitParticipantIntoLanes,
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
  handleAddElementChain,
  handleCreateParticipant,
  handleHandoffToLane,
  handleSuggestLaneOrganization,
  handleValidateLaneOrganization,
  handleConvertCollaborationToLanes,
  handleSuggestPoolVsLanes,
  handleRedistributeElementsAcrossLanes,
  handleAutosizePoolsAndLanes,
  handleSummarizeDiagram,
  handleListProcessVariables,
  handleSetConnectionWaypoints,
  handleAnalyzeLanes,
};
