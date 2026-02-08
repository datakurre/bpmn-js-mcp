/**
 * Shared helpers used by individual tool handler modules.
 */

import { type ToolResult } from "../types";
import { getDiagram } from "../diagram-manager";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// ── Runtime argument validation ────────────────────────────────────────────

/**
 * Validate that all `requiredKeys` are present and non-undefined in `args`.
 * Throws an MCP InvalidParams error with a clear message listing missing keys.
 */
export function validateArgs<T extends object>(
  args: T,
  requiredKeys: (keyof T & string)[],
): void {
  const missing = requiredKeys.filter(
    (key) => args[key] === undefined || args[key] === null,
  );
  if (missing.length > 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Missing required argument(s): ${missing.join(", ")}`,
    );
  }
}

// ── Descriptive ID generation ──────────────────────────────────────────────

/**
 * Convert a human-readable name into a PascalCase slug suitable for BPMN IDs.
 * Strips non-alphanumeric chars, collapses whitespace, PascalCases each word.
 */
function toPascalSlug(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** Map full BPMN type to a short prefix for element IDs. */
function typePrefix(bpmnType: string): string {
  // e.g. "bpmn:UserTask" → "UserTask", "bpmn:ExclusiveGateway" → "Gateway"
  const short = bpmnType.replace("bpmn:", "");
  if (short.includes("Gateway")) return "Gateway";
  if (short === "StartEvent" || short === "EndEvent") return short;
  if (short.includes("Event")) return "Event";
  if (short === "SubProcess") return "SubProcess";
  if (short === "CallActivity") return "CallActivity";
  if (short.includes("Task")) return short;           // UserTask, ServiceTask…
  if (short === "TextAnnotation") return "Annotation";
  if (short === "DataObjectReference") return "DataObject";
  if (short === "DataStoreReference") return "DataStore";
  if (short === "Participant") return "Participant";
  if (short === "Lane") return "Lane";
  return short;
}

/**
 * Generate a descriptive element ID.
 *
 * When a name is supplied the ID looks like `UserTask_EnterName`.
 * Falls back to the bpmn-js default (random suffix) when no name is given.
 * Appends a numeric suffix if the ID already exists in the registry.
 */
export function generateDescriptiveId(
  elementRegistry: any,
  bpmnType: string,
  name?: string,
): string | undefined {
  if (!name) return undefined; // let bpmn-js assign a default
  const prefix = typePrefix(bpmnType);
  const slug = toPascalSlug(name);
  if (!slug) return undefined;

  const candidate = `${prefix}_${slug}`;
  if (!elementRegistry.get(candidate)) return candidate;

  // Collision – append incrementing counter
  let counter = 2;
  while (elementRegistry.get(`${candidate}_${counter}`)) counter++;
  return `${candidate}_${counter}`;
}

/** Generate a descriptive ID for a sequence flow / connection. */
export function generateFlowId(
  elementRegistry: any,
  sourceName?: string,
  targetName?: string,
  label?: string,
): string | undefined {
  let slug: string;
  if (label) {
    slug = toPascalSlug(label);
  } else if (sourceName && targetName) {
    slug = `${toPascalSlug(sourceName)}_to_${toPascalSlug(targetName)}`;
  } else {
    return undefined;
  }
  if (!slug) return undefined;

  const candidate = `Flow_${slug}`;
  if (!elementRegistry.get(candidate)) return candidate;

  let counter = 2;
  while (elementRegistry.get(`${candidate}_${counter}`)) counter++;
  return `${candidate}_${counter}`;
}

/** Look up a diagram by ID, throwing an MCP error if not found. */
export function requireDiagram(diagramId: string) {
  const diagram = getDiagram(diagramId);
  if (!diagram) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Diagram not found: ${diagramId}`,
    );
  }
  return diagram;
}

/** Look up an element by ID, throwing an MCP error if not found. */
export function requireElement(elementRegistry: any, elementId: string) {
  const element = elementRegistry.get(elementId);
  if (!element) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Element not found: ${elementId}`,
    );
  }
  return element;
}

/** Wrap a plain object into the MCP tool-result envelope. */
export function jsonResult(data: Record<string, any>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/** Build warnings about disconnected elements for export outputs. */
export function buildConnectivityWarnings(elementRegistry: any): string[] {
  const elements = elementRegistry.filter(
    (el: any) =>
      el.type &&
      (el.type.includes("Event") ||
        el.type.includes("Task") ||
        el.type.includes("Gateway") ||
        el.type.includes("SubProcess") ||
        el.type.includes("CallActivity")),
  );
  const flows = elementRegistry.filter(
    (el: any) =>
      el.type === "bpmn:SequenceFlow" ||
      el.type === "bpmn:MessageFlow",
  );

  const warnings: string[] = [];
  if (elements.length > 1 && flows.length === 0) {
    warnings.push(
      `⚠️ Note: Diagram has ${elements.length} elements but no flows. Use connect_bpmn_elements to add flows.`,
    );
  } else if (elements.length > flows.length + 1) {
    warnings.push(
      `💡 Tip: ${elements.length} elements with ${flows.length} flows - some elements may be disconnected.`,
    );
  }
  return warnings;
}

/** Save XML back to diagram state. */
export async function syncXml(diagram: ReturnType<typeof requireDiagram>) {
  const { xml } = await diagram.modeler.saveXML({ format: true });
  diagram.xml = xml || "";
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
      el.type !== "bpmn:Process" &&
      el.type !== "bpmn:Collaboration" &&
      el.type !== "label" &&
      !el.type.includes("BPMNDiagram") &&
      !el.type.includes("BPMNPlane"),
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
  newValue: any,
): void {
  let extensionElements = bo.extensionElements;
  if (!extensionElements) {
    extensionElements = moddle.create("bpmn:ExtensionElements", { values: [] });
    extensionElements.$parent = bo;
  }

  extensionElements.values = (extensionElements.values || []).filter(
    (v: any) => v.$type !== typeName,
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
  errorRef: { id: string; name?: string; errorCode?: string },
): any {
  if (!definitions.rootElements) definitions.rootElements = [];

  let errorElement = definitions.rootElements.find(
    (re: any) => re.$type === "bpmn:Error" && re.id === errorRef.id,
  );
  if (!errorElement) {
    errorElement = moddle.create("bpmn:Error", {
      id: errorRef.id,
      name: errorRef.name || errorRef.id,
      errorCode: errorRef.errorCode,
    });
    definitions.rootElements.push(errorElement);
    errorElement.$parent = definitions;
  }
  return errorElement;
}
