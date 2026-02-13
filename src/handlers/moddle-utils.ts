/**
 * @internal
 * Moddle / extension-element utilities for BPMN element manipulation.
 *
 * Provides helpers for managing extensionElements containers, creating
 * business objects with specific IDs, and fixing connection BO IDs.
 */

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
  const bpmnFactory = modeler.get('bpmnFactory');
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
