/**
 * Shared interfaces used across the bpmn-js-mcp server.
 */

// ── Diagram state ──────────────────────────────────────────────────────────

/** Minimal interface for the bpmn-js Modeler services we use. */
export interface BpmnModeler {
  get(service: string): any;
  saveXML(options?: { format?: boolean }): Promise<{ xml: string }>;
  saveSVG(): Promise<{ svg: string }>;
  importXML(xml: string): Promise<any>;
}

/** State for a single in-memory BPMN diagram. */
export interface DiagramState {
  modeler: BpmnModeler;
  xml: string;
  name?: string;
  /** When true, suppress implicit lint feedback on mutating operations. */
  draftMode?: boolean;
  /** Monotonically increasing version counter, bumped on each mutation. */
  version?: number;
}

/** Shape of the JSON returned by tool handlers that wrap results. */
export interface ToolResult {
  content: Array<{ type: string; text: string }>;
}
