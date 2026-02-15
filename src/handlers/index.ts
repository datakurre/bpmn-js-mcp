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
import {
  handleReplaceElement,
  TOOL_DEFINITION as REPLACE_ELEMENT_DEF,
} from './elements/replace-element';
import { handleAddElementChain } from './elements/add-element-chain';
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
import { handleAssignElementsToLane } from './collaboration/assign-elements-to-lane';
import { handleWrapProcessInCollaboration } from './collaboration/wrap-process-in-collaboration';
import { handleSplitParticipantIntoLanes } from './collaboration/split-participant-into-lanes';
import {
  handleCreateParticipant,
  TOOL_DEFINITION as CREATE_PARTICIPANT_DEF,
} from './collaboration/create-participant';
import { handleHandoffToLane } from './collaboration/handoff-to-lane';
import { handleSuggestLaneOrganization } from './collaboration/suggest-lane-organization';
import { handleValidateLaneOrganization } from './collaboration/validate-lane-organization';
import { handleConvertCollaborationToLanes } from './collaboration/convert-collaboration-to-lanes';
import { handleResizePoolToFit } from './collaboration/resize-pool-to-fit';
import { handleSuggestPoolVsLanes } from './collaboration/suggest-pool-vs-lanes';
import {
  handleAnalyzeLanes,
  TOOL_DEFINITION as ANALYZE_LANES_DEF,
} from './collaboration/analyze-lanes';
import {
  handleRedistributeElementsAcrossLanes,
  TOOL_DEFINITION as REDISTRIBUTE_ELEMENTS_ACROSS_LANES_DEF,
} from './collaboration/redistribute-elements-across-lanes';
import { handleAutosizePoolsAndLanes } from './collaboration/autosize-pools-and-lanes';
import { handleOptimizeLaneAssignments } from './collaboration/optimize-lane-assignments';

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
  {
    definition: REDISTRIBUTE_ELEMENTS_ACROSS_LANES_DEF,
    handler: handleRedistributeElementsAcrossLanes,
  },
  { definition: REPLACE_ELEMENT_DEF, handler: handleReplaceElement },
  { definition: LIST_PROCESS_VARIABLES_DEF, handler: handleListProcessVariables },
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

/** Property definition for `_clientRequestId` injected into mutating tools. */
const CLIENT_REQUEST_ID_PROP = {
  type: 'string',
  description:
    'Optional client-provided request ID for idempotent retry. ' +
    'If the same ID is sent again, the server returns the cached result ' +
    'without re-executing the operation.',
} as const;

/**
 * MCP tool definitions (passed to ListTools).
 *
 * Mutating tools are augmented with an optional `_clientRequestId` property
 * so callers can safely retry on network errors.
 */
export const TOOL_DEFINITIONS: Array<{ name: string; [key: string]: unknown }> = TOOL_REGISTRY.map(
  (r) => {
    if (READONLY_TOOLS.has(r.definition.name as string)) return r.definition;

    // Augment mutating tool definitions with _clientRequestId
    const def = r.definition as Record<string, any>;
    const schema = def.inputSchema as Record<string, any> | undefined;
    if (!schema?.properties) return r.definition;

    return {
      ...def,
      name: def.name as string,
      inputSchema: {
        ...schema,
        properties: {
          ...schema.properties,
          _clientRequestId: CLIENT_REQUEST_ID_PROP,
        },
      },
    };
  }
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
  handleResizePoolToFit,
  handleSuggestPoolVsLanes,
  handleRedistributeElementsAcrossLanes,
  handleAutosizePoolsAndLanes,
  handleOptimizeLaneAssignments,
  handleSummarizeDiagram,
  handleListProcessVariables,
  handleSetConnectionWaypoints,
  handleAnalyzeLanes,
};
