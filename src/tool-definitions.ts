/**
 * MCP tool schema definitions — thin barrel.
 *
 * Each tool definition is co-located with its handler module.
 * This file collects them into a single array for the MCP server.
 */

import { TOOL_DEFINITION as CREATE_DIAGRAM } from './handlers/create-diagram';
import { TOOL_DEFINITION as ADD_ELEMENT } from './handlers/add-element';
import { TOOL_DEFINITION as CONNECT } from './handlers/connect';
import { TOOL_DEFINITION as DELETE_ELEMENT } from './handlers/delete-element';
import { TOOL_DEFINITION as MOVE_ELEMENT } from './handlers/move-element';
import { TOOL_DEFINITION as GET_PROPERTIES } from './handlers/get-properties';
import { TOOL_DEFINITION as EXPORT_BPMN } from './handlers/export';
import { TOOL_DEFINITION as LIST_ELEMENTS } from './handlers/list-elements';
import { TOOL_DEFINITION as SET_PROPERTIES } from './handlers/set-properties';
import { TOOL_DEFINITION as IMPORT_XML } from './handlers/import-xml';
import { TOOL_DEFINITION as DELETE_DIAGRAM } from './handlers/delete-diagram';
import { TOOL_DEFINITION as LIST_DIAGRAMS } from './handlers/list-diagrams';
import { TOOL_DEFINITION as CLONE_DIAGRAM } from './handlers/clone-diagram';
import { TOOL_DEFINITION as VALIDATE } from './handlers/validate';
import { TOOL_DEFINITION as ALIGN_ELEMENTS } from './handlers/align-elements';
import { TOOL_DEFINITION as DISTRIBUTE_ELEMENTS } from './handlers/distribute-elements';
import { TOOL_DEFINITION as SET_INPUT_OUTPUT } from './handlers/set-input-output';
import { TOOL_DEFINITION as SET_EVENT_DEFINITION } from './handlers/set-event-definition';
import { TOOL_DEFINITION as SET_FORM_DATA } from './handlers/set-form-data';
import { TOOL_DEFINITION as LAYOUT_DIAGRAM } from './handlers/layout-diagram';
import { TOOL_DEFINITION as SET_CAMUNDA_ERROR } from './handlers/set-camunda-error';
import { TOOL_DEFINITION as SET_LOOP_CHARACTERISTICS } from './handlers/set-loop-characteristics';
import { TOOL_DEFINITION as ADJUST_LABELS } from './handlers/adjust-labels-handler';
import { TOOL_DEFINITION as SET_SCRIPT } from './handlers/set-script';
import { TOOL_DEFINITION as CREATE_COLLABORATION } from './handlers/create-collaboration';
import { TOOL_DEFINITION as BPMN_HISTORY } from './handlers/undo';
import { TOOL_DEFINITION as DIFF_DIAGRAMS } from './handlers/diff-diagrams';
import { TOOL_DEFINITION as BATCH_OPERATIONS } from './handlers/batch-operations';
import { TOOL_DEFINITION as RESIZE_ELEMENT } from './handlers/resize-element';
import { TOOL_DEFINITION as SET_CAMUNDA_LISTENERS } from './handlers/set-camunda-listeners';
import { TOOL_DEFINITION as SET_CALL_ACTIVITY_VARIABLES } from './handlers/set-call-activity-variables';
import { TOOL_DEFINITION as MANAGE_ROOT_ELEMENTS } from './handlers/manage-root-elements';
import { TOOL_DEFINITION as DUPLICATE_ELEMENT } from './handlers/duplicate-element';
import { TOOL_DEFINITION as INSERT_ELEMENT } from './handlers/insert-element';
import { TOOL_DEFINITION as REPLACE_ELEMENT } from './handlers/replace-element';
import { TOOL_DEFINITION as SUMMARIZE_DIAGRAM } from './handlers/summarize-diagram';

export const TOOL_DEFINITIONS = [
  CREATE_DIAGRAM,
  ADD_ELEMENT,
  CONNECT,
  DELETE_ELEMENT,
  MOVE_ELEMENT,
  GET_PROPERTIES,
  EXPORT_BPMN,
  LIST_ELEMENTS,
  SET_PROPERTIES,
  IMPORT_XML,
  DELETE_DIAGRAM,
  LIST_DIAGRAMS,
  CLONE_DIAGRAM,
  VALIDATE,
  ALIGN_ELEMENTS,
  DISTRIBUTE_ELEMENTS,
  SET_INPUT_OUTPUT,
  SET_EVENT_DEFINITION,
  SET_FORM_DATA,
  LAYOUT_DIAGRAM,
  SET_CAMUNDA_ERROR,
  SET_LOOP_CHARACTERISTICS,
  ADJUST_LABELS,
  SET_SCRIPT,
  CREATE_COLLABORATION,
  BPMN_HISTORY,
  DIFF_DIAGRAMS,
  BATCH_OPERATIONS,
  RESIZE_ELEMENT,
  SET_CAMUNDA_LISTENERS,
  SET_CALL_ACTIVITY_VARIABLES,
  MANAGE_ROOT_ELEMENTS,
  DUPLICATE_ELEMENT,
  INSERT_ELEMENT,
  REPLACE_ELEMENT,
  SUMMARIZE_DIAGRAM,
] as const;
