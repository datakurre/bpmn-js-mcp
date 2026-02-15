/**
 * Shared interfaces used across the bpmn-js-mcp server.
 */

// ── Diagram state ──────────────────────────────────────────────────────────

/**
 * Controls how much implicit feedback is included in tool responses.
 *
 * - `'full'`    — lint errors, layout hints, connectivity warnings (default)
 * - `'minimal'` — lint errors only
 * - `'none'`   — no implicit feedback (equivalent to legacy draftMode)
 */
export type HintLevel = 'none' | 'minimal' | 'full';

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
  /** When true, suppress implicit lint feedback on mutating operations.
   *  @deprecated Use `hintLevel: 'none'` instead.
   */
  draftMode?: boolean;
  /**
   * Controls implicit feedback verbosity on mutating operations.
   * Overrides `draftMode` when set.
   * - `'full'`    — lint errors + layout hints + connectivity warnings (default)
   * - `'minimal'` — lint errors only
   * - `'none'`   — no implicit feedback
   */
  hintLevel?: HintLevel;
  /** Monotonically increasing version counter, bumped on each mutation. */
  version?: number;
  /** Count of structural mutations since the last layout_bpmn_diagram call. */
  mutationsSinceLayout?: number;
}

/** Shape of the JSON returned by tool handlers that wrap results. */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: string; text: string }>;
}
