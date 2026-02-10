/**
 * Shared helpers for managing BPMN root-level elements
 * (bpmn:Error, bpmn:Message, bpmn:Signal, bpmn:Escalation).
 *
 * Extracted from helpers.ts to keep module sizes under the max-lines limit.
 */

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
  errorRef: { id: string; name?: string; errorCode?: string }
): any {
  if (!definitions.rootElements) definitions.rootElements = [];

  let errorElement = definitions.rootElements.find(
    (re: any) => re.$type === 'bpmn:Error' && re.id === errorRef.id
  );
  if (!errorElement) {
    errorElement = moddle.create('bpmn:Error', {
      id: errorRef.id,
      name: errorRef.name || errorRef.id,
      errorCode: errorRef.errorCode,
    });
    definitions.rootElements.push(errorElement);
    errorElement.$parent = definitions;
  }
  return errorElement;
}

/**
 * Find or create a `bpmn:Message` root element on the definitions.
 */
export function resolveOrCreateMessage(
  moddle: any,
  definitions: any,
  messageRef: { id: string; name?: string }
): any {
  if (!definitions.rootElements) definitions.rootElements = [];

  let messageElement = definitions.rootElements.find(
    (re: any) => re.$type === 'bpmn:Message' && re.id === messageRef.id
  );
  if (!messageElement) {
    messageElement = moddle.create('bpmn:Message', {
      id: messageRef.id,
      name: messageRef.name || messageRef.id,
    });
    definitions.rootElements.push(messageElement);
    messageElement.$parent = definitions;
  }
  return messageElement;
}

/**
 * Find or create a `bpmn:Signal` root element on the definitions.
 */
export function resolveOrCreateSignal(
  moddle: any,
  definitions: any,
  signalRef: { id: string; name?: string }
): any {
  if (!definitions.rootElements) definitions.rootElements = [];

  let signalElement = definitions.rootElements.find(
    (re: any) => re.$type === 'bpmn:Signal' && re.id === signalRef.id
  );
  if (!signalElement) {
    signalElement = moddle.create('bpmn:Signal', {
      id: signalRef.id,
      name: signalRef.name || signalRef.id,
    });
    definitions.rootElements.push(signalElement);
    signalElement.$parent = definitions;
  }
  return signalElement;
}

/**
 * Find or create a `bpmn:Escalation` root element on the definitions.
 */
export function resolveOrCreateEscalation(
  moddle: any,
  definitions: any,
  escalationRef: { id: string; name?: string; escalationCode?: string }
): any {
  if (!definitions.rootElements) definitions.rootElements = [];

  let escalationElement = definitions.rootElements.find(
    (re: any) => re.$type === 'bpmn:Escalation' && re.id === escalationRef.id
  );
  if (!escalationElement) {
    escalationElement = moddle.create('bpmn:Escalation', {
      id: escalationRef.id,
      name: escalationRef.name || escalationRef.id,
      escalationCode: escalationRef.escalationCode,
    });
    definitions.rootElements.push(escalationElement);
    escalationElement.$parent = definitions;
  }
  return escalationElement;
}
