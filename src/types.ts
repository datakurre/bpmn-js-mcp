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
  /**
   * Set of element IDs that have been manually positioned by the user
   * (via move_bpmn_element). Partial re-layouts skip pinned elements
   * unless explicitly included. Full layout clears this set.
   */
  pinnedElements?: Set<string>;
}

/** Shape of the JSON returned by tool handlers that wrap results. */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: string; text: string }>;
}

// ── Tool execution context ─────────────────────────────────────────────────

/**
 * Optional context threaded through tool dispatch into handlers.
 *
 * Currently carries a progress-notification callback derived from the
 * MCP `extra.sendNotification` the server receives per-request.
 * Handlers that perform long-running work (import, layout, export) can
 * call `sendProgress` to emit `notifications/progress` to the client.
 */
export interface ToolContext {
  /**
   * Emit a progress notification to the connected MCP client.
   *
   * Only available when the client included a `progressToken` in the
   * request's `_meta`.  Handlers should guard with `context?.sendProgress?.(…)`.
   *
   * @param progress  Current progress value (should increase monotonically).
   * @param total     Total work units (omit if unknown).
   * @param message   Optional human-readable status string.
   */
  sendProgress?: (progress: number, total?: number, message?: string) => Promise<void>;
}
