/**
 * @internal
 * Moddle / extension-element utilities for BPMN element manipulation.
 *
 * Provides helpers for managing extensionElements containers, creating
 * business objects with specific IDs, and fixing connection BO IDs.
 * Also provides helpers for managing BPMN root-level elements
 * (bpmn:Error, bpmn:Message, bpmn:Signal, bpmn:Escalation).
 */

import { getService } from '../bpmn-types';

// ── Shared extensionElements management ────────────────────────────────────

/**
 * Get-or-create the extensionElements container on a business object,
 * remove any existing entries of `typeName`, push a new value, and
 * trigger a modeling update.
 *
 * Replaces the repeated "ensure extensionElements → filter → push →
 * updateProperties" pattern in set-form-data, set-input-output, and
 * set-camunda-error handlers.
 */
export function upsertExtensionElement(
  moddle: any,
  bo: any,
  modeling: any,
  element: any,
  typeName: string,
  newValue: any
): void {
  let extensionElements = bo.extensionElements;
  if (!extensionElements) {
    extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    extensionElements.$parent = bo;
  }

  extensionElements.values = (extensionElements.values || []).filter(
    (v: any) => v.$type !== typeName
  );
  newValue.$parent = extensionElements;
  extensionElements.values.push(newValue);

  modeling.updateProperties(element, { extensionElements });
}

// ── Business-object / ID alignment helpers ─────────────────────────────────

/**
 * Create a BPMN business object with a specific ID via the bpmnFactory.
 *
 * Without this, bpmn-js auto-generates a different ID on the business
 * object (e.g. 'Activity_0v3c6jj') while the shape receives our
 * descriptive ID.  Since XML export serialises the *business-object* ID,
 * the exported XML would not match the element IDs returned by MCP tools.
 */
export function createBusinessObject(modeler: any, bpmnType: string, id: string): any {
  const bpmnFactory = getService(modeler, 'bpmnFactory');
  return bpmnFactory.create(bpmnType, { id });
}

/**
 * Ensure a connection's business-object ID matches the desired flow ID.
 *
 * `modeling.connect` may auto-generate a different business-object ID.
 * This post-fix ensures the exported XML uses our descriptive flow IDs.
 */
export function fixConnectionId(connection: any, desiredId: string): void {
  if (connection.businessObject && connection.businessObject.id !== desiredId) {
    connection.businessObject.id = desiredId;
  }
}

// ── Generic root-element resolution ────────────────────────────────────────

/**
 * Find or create a BPMN root element (Error, Message, Signal, Escalation).
 * Replaces the duplicated "find existing or create" pattern across 4 specialized functions.
 *
 * Creating a new root element goes through `modeling.updateModdleProperties`
 * (not a direct `definitions.rootElements.push`) so it is captured on the
 * command stack and undoable — a direct push is invisible to `commandStack`
 * and leaves an orphaned root element behind on rollback (e.g. the `updates[]`
 * batch form's all-or-nothing rollback in set-properties.ts).
 *
 * @param moddle - bpmn-moddle instance
 * @param modeling - bpmn-js modeling service
 * @param triggerElement - diagram element to attribute the command to (any element in the diagram works — `definitions` has no shape of its own)
 * @param definitions - bpmn:Definitions element
 * @param type - BPMN type string (e.g. 'bpmn:Error', 'bpmn:Message')
 * @param ref - Object with id (required) and optional properties (name, errorCode, escalationCode, etc.)
 * @returns The found or newly created root element
 */
function resolveOrCreate<T = any>(
  moddle: any,
  modeling: any,
  triggerElement: any,
  definitions: any,
  type: string,
  ref: { id: string; [key: string]: any }
): T {
  const rootElements = definitions.rootElements || [];

  const existing = rootElements.find((re: any) => re.$type === type && re.id === ref.id);
  if (existing) return existing as T;

  // Create with all properties from ref, defaulting name to id if not provided
  const props = { ...ref };
  if (!props.name) props.name = ref.id;

  const element = moddle.create(type, props);
  element.$parent = definitions;

  modeling.updateModdleProperties(triggerElement, definitions, {
    rootElements: [...rootElements, element],
  });

  return element as T;
}

// ── Shared bpmn:Error root-element resolution ──────────────────────────────

/**
 * Find or create a `bpmn:Error` root element on the definitions.
 *
 * Replaces the duplicated "find existing or create bpmn:Error" pattern in
 * set-event-definition and set-camunda-error handlers.
 */
export function resolveOrCreateError(
  moddle: any,
  modeling: any,
  triggerElement: any,
  definitions: any,
  errorRef: { id: string; name?: string; errorCode?: string; errorMessage?: string }
): any {
  return resolveOrCreate(moddle, modeling, triggerElement, definitions, 'bpmn:Error', errorRef);
}

/**
 * Find or create a `bpmn:Message` root element on the definitions.
 */
export function resolveOrCreateMessage(
  moddle: any,
  modeling: any,
  triggerElement: any,
  definitions: any,
  messageRef: { id: string; name?: string }
): any {
  return resolveOrCreate(moddle, modeling, triggerElement, definitions, 'bpmn:Message', messageRef);
}

/**
 * Find or create a `bpmn:Signal` root element on the definitions.
 */
export function resolveOrCreateSignal(
  moddle: any,
  modeling: any,
  triggerElement: any,
  definitions: any,
  signalRef: { id: string; name?: string }
): any {
  return resolveOrCreate(moddle, modeling, triggerElement, definitions, 'bpmn:Signal', signalRef);
}

/**
 * Find or create a `bpmn:Escalation` root element on the definitions.
 */
export function resolveOrCreateEscalation(
  moddle: any,
  modeling: any,
  triggerElement: any,
  definitions: any,
  escalationRef: { id: string; name?: string; escalationCode?: string }
): any {
  return resolveOrCreate(
    moddle,
    modeling,
    triggerElement,
    definitions,
    'bpmn:Escalation',
    escalationRef
  );
}
