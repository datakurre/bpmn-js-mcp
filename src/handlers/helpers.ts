/**
 * Shared helpers used by individual tool handler modules.
 */

import { type ToolResult } from '../types';
import { getDiagram } from '../diagram-manager';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// ── Runtime argument validation ────────────────────────────────────────────

/**
 * Validate that all `requiredKeys` are present and non-undefined in `args`.
 * Throws an MCP InvalidParams error with a clear message listing missing keys.
 */
export function validateArgs<T extends object>(args: T, requiredKeys: (keyof T & string)[]): void {
  const missing = requiredKeys.filter((key) => args[key] === undefined || args[key] === null);
  if (missing.length > 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Missing required argument(s): ${missing.join(', ')}`
    );
  }
}

// ── Descriptive ID generation ──────────────────────────────────────────────

/**
 * Generate a 7-character random alphanumeric string (lowercase).
 * Mimics bpmn-js default random suffix format.
 */
function generateRandomPart(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 7; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Convert a human-readable name into a PascalCase slug suitable for BPMN IDs.
 * Strips non-alphanumeric chars, collapses whitespace, PascalCases each word.
 */
function toPascalSlug(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** Map full BPMN type to a short prefix for element IDs. */
function typePrefix(bpmnType: string): string {
  // e.g. "bpmn:UserTask" → "UserTask", "bpmn:ExclusiveGateway" → "Gateway"
  const short = bpmnType.replace('bpmn:', '');
  if (short.includes('Gateway')) return 'Gateway';
  if (short === 'StartEvent' || short === 'EndEvent') return short;
  if (short.includes('Event')) return 'Event';
  if (short === 'SubProcess') return 'SubProcess';
  if (short === 'CallActivity') return 'CallActivity';
  if (short.includes('Task')) return short; // UserTask, ServiceTask…
  if (short === 'TextAnnotation') return 'Annotation';
  if (short === 'DataObjectReference') return 'DataObject';
  if (short === 'DataStoreReference') return 'DataStore';
  if (short === 'Group') return 'Group';
  if (short === 'Participant') return 'Participant';
  if (short === 'Lane') return 'Lane';
  return short;
}

/**
 * Generate a descriptive element ID.
 *
 * Prefers short 2-part IDs: `UserTask_EnterName` or `StartEvent_<random7>`.
 * Falls back to 3-part IDs on collision: `UserTask_<random7>_EnterName`.
 *
 * Named elements get a clean slug first; unnamed elements always include a
 * random 7-char alphanumeric part for uniqueness.
 */
export function generateDescriptiveId(
  elementRegistry: any,
  bpmnType: string,
  name?: string
): string {
  const prefix = typePrefix(bpmnType);

  if (name) {
    const slug = toPascalSlug(name);
    if (slug) {
      // Try short 2-part ID first: UserTask_EnterName
      const candidate = `${prefix}_${slug}`;
      if (!elementRegistry.get(candidate)) return candidate;

      // Collision — fall back to 3-part ID: UserTask_<random7>_EnterName
      let fallback: string;
      let attempts = 0;
      do {
        fallback = `${prefix}_${generateRandomPart()}_${slug}`;
        attempts++;
      } while (elementRegistry.get(fallback) && attempts < 100);
      return fallback;
    }
  }

  // No name (or empty slug) — 2-part with random: StartEvent_<random7>
  let candidate: string;
  let attempts = 0;
  do {
    candidate = `${prefix}_${generateRandomPart()}`;
    attempts++;
  } while (elementRegistry.get(candidate) && attempts < 100);
  return candidate;
}

/**
 * Generate a descriptive ID for a sequence flow / connection.
 *
 * Prefers short 2-part IDs: `Flow_Done` or `Flow_Begin_to_Finish`.
 * Falls back to 3-part IDs on collision: `Flow_<random7>_Done`.
 * When no label/names are available: `Flow_<random7>`.
 */
export function generateFlowId(
  elementRegistry: any,
  sourceName?: string,
  targetName?: string,
  label?: string
): string {
  let slug: string | undefined;
  if (label) {
    slug = toPascalSlug(label);
  } else if (sourceName && targetName) {
    slug = `${toPascalSlug(sourceName)}_to_${toPascalSlug(targetName)}`;
  }

  if (slug) {
    // Try short 2-part ID first: Flow_Done
    const candidate = `Flow_${slug}`;
    if (!elementRegistry.get(candidate)) return candidate;

    // Collision — fall back to 3-part ID: Flow_<random7>_Done
    let fallback: string;
    let attempts = 0;
    do {
      fallback = `Flow_${generateRandomPart()}_${slug}`;
      attempts++;
    } while (elementRegistry.get(fallback) && attempts < 100);
    return fallback;
  }

  // No names available — 2-part with random: Flow_<random7>
  let candidate: string;
  let attempts = 0;
  do {
    candidate = `Flow_${generateRandomPart()}`;
    attempts++;
  } while (elementRegistry.get(candidate) && attempts < 100);
  return candidate;
}

/** Look up a diagram by ID, throwing an MCP error if not found. */
export function requireDiagram(diagramId: string) {
  const diagram = getDiagram(diagramId);
  if (!diagram) {
    throw new McpError(ErrorCode.InvalidRequest, `Diagram not found: ${diagramId}`);
  }
  return diagram;
}

/** Look up an element by ID, throwing an MCP error if not found. */
export function requireElement(elementRegistry: any, elementId: string) {
  const element = elementRegistry.get(elementId);
  if (!element) {
    throw new McpError(ErrorCode.InvalidRequest, `Element not found: ${elementId}`);
  }
  return element;
}

/** Wrap a plain object into the MCP tool-result envelope. */
export function jsonResult(data: Record<string, any>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/** Build warnings about disconnected elements for export outputs. */
export function buildConnectivityWarnings(elementRegistry: any): string[] {
  const elements = elementRegistry.filter(
    (el: any) =>
      el.type &&
      (el.type.includes('Event') ||
        el.type.includes('Task') ||
        el.type.includes('Gateway') ||
        el.type.includes('SubProcess') ||
        el.type.includes('CallActivity'))
  );
  const flows = elementRegistry.filter(
    (el: any) => el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow'
  );

  const warnings: string[] = [];
  if (elements.length > 1 && flows.length === 0) {
    warnings.push(
      `⚠️ Note: Diagram has ${elements.length} elements but no flows. Use connect_bpmn_elements to add flows.`
    );
  } else if (elements.length > flows.length + 1) {
    warnings.push(
      `💡 Tip: ${elements.length} elements with ${flows.length} flows - some elements may be disconnected.`
    );
  }

  // Warn about orphaned artifacts (TextAnnotation, DataObjectReference, DataStoreReference)
  const artifactTypes = new Set([
    'bpmn:TextAnnotation',
    'bpmn:DataObjectReference',
    'bpmn:DataStoreReference',
  ]);
  const artifacts = elementRegistry.filter((el: any) => artifactTypes.has(el.type));
  if (artifacts.length > 0) {
    const associations = elementRegistry.filter(
      (el: any) =>
        el.type === 'bpmn:Association' ||
        el.type === 'bpmn:DataInputAssociation' ||
        el.type === 'bpmn:DataOutputAssociation'
    );
    const connectedIds = new Set<string>();
    for (const assoc of associations) {
      if (assoc.source) connectedIds.add(assoc.source.id);
      if (assoc.target) connectedIds.add(assoc.target.id);
    }
    const orphaned = artifacts.filter((a: any) => !connectedIds.has(a.id));
    if (orphaned.length > 0) {
      const names = orphaned.map((a: any) => `${a.id} (${a.type.replace('bpmn:', '')})`).join(', ');
      warnings.push(
        `⚠️ Disconnected artifact(s): ${names}. Use connect_bpmn_elements to link them (auto-detects Association or DataAssociation).`
      );
    }
  }

  return warnings;
}

/** Save XML back to diagram state. */
export async function syncXml(diagram: ReturnType<typeof requireDiagram>) {
  const { xml } = await diagram.modeler.saveXML({ format: true });
  diagram.xml = xml || '';
}

// ── Shared element-filtering helper ────────────────────────────────────────

/**
 * Return all "visible" elements from the registry, filtering out
 * infrastructure types (Process, Collaboration, labels, diagram planes).
 *
 * This replaces the repeated inline filter that appeared in 5+ handler files.
 */
export function getVisibleElements(elementRegistry: any): any[] {
  return elementRegistry.filter(
    (el: any) =>
      el.type &&
      el.type !== 'bpmn:Process' &&
      el.type !== 'bpmn:Collaboration' &&
      el.type !== 'label' &&
      !el.type.includes('BPMNDiagram') &&
      !el.type.includes('BPMNPlane')
  );
}

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
