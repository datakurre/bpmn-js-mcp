/**
 * Shared helpers for managing BPMN root-level elements
 * (bpmn:Error, bpmn:Message, bpmn:Signal, bpmn:Escalation).
 *
 * Extracted from helpers.ts to keep module sizes under the max-lines limit.
 */

// ── Generic root-element resolution ────────────────────────────────────────

/**
 * Find or create a BPMN root element (Error, Message, Signal, Escalation).
 * Replaces the duplicated "find existing or create" pattern across 4 specialized functions.
 *
 * @param moddle - bpmn-moddle instance
 * @param definitions - bpmn:Definitions element
 * @param type - BPMN type string (e.g. 'bpmn:Error', 'bpmn:Message')
 * @param ref - Object with id (required) and optional properties (name, errorCode, escalationCode, etc.)
 * @returns The found or newly created root element
 */
function resolveOrCreate<T = any>(
  moddle: any,
  definitions: any,
  type: string,
  ref: { id: string; [key: string]: any }
): T {
  if (!definitions.rootElements) definitions.rootElements = [];

  let element = definitions.rootElements.find((re: any) => re.$type === type && re.id === ref.id);
  if (!element) {
    // Create with all properties from ref, defaulting name to id if not provided
    const props = { ...ref };
    if (!props.name) props.name = ref.id;

    element = moddle.create(type, props);
    definitions.rootElements.push(element);
    element.$parent = definitions;
  }
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
  definitions: any,
  errorRef: { id: string; name?: string; errorCode?: string; errorMessage?: string }
): any {
  return resolveOrCreate(moddle, definitions, 'bpmn:Error', errorRef);
}

/**
 * Find or create a `bpmn:Message` root element on the definitions.
 */
export function resolveOrCreateMessage(
  moddle: any,
  definitions: any,
  messageRef: { id: string; name?: string }
): any {
  return resolveOrCreate(moddle, definitions, 'bpmn:Message', messageRef);
}

/**
 * Find or create a `bpmn:Signal` root element on the definitions.
 */
export function resolveOrCreateSignal(
  moddle: any,
  definitions: any,
  signalRef: { id: string; name?: string }
): any {
  return resolveOrCreate(moddle, definitions, 'bpmn:Signal', signalRef);
}

/**
 * Find or create a `bpmn:Escalation` root element on the definitions.
 */
export function resolveOrCreateEscalation(
  moddle: any,
  definitions: any,
  escalationRef: { id: string; name?: string; escalationCode?: string }
): any {
  return resolveOrCreate(moddle, definitions, 'bpmn:Escalation', escalationRef);
}
