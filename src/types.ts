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

/** Image format token for includeImage. */
export type IncludeImageFormat = 'png' | 'svg';

/**
 * Controls which image formats are appended to mutating tool responses.
 *
 * - `Array<IncludeImageFormat>` — explicit list, e.g. `['png']`, `['svg']`, `['png', 'svg']`
 * - `true`  — backward-compat shorthand for `['png']`
 * - `false` — no images (keep responses small)
 */
export type IncludeImage = IncludeImageFormat[] | boolean;

/**
 * Normalise any IncludeImage value to a concrete set of formats.
 * `undefined` and `false` → `[]`; `true` → `['png']`.
 */
export function resolveIncludeFormats(value: IncludeImage | undefined): IncludeImageFormat[] {
  if (!value) return [];
  if (value === true) return ['png'];
  return value as IncludeImageFormat[];
}

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
  /**
   * Set of connection IDs whose waypoints have been manually set by the user
   * (via connect_bpmn_elements with connectionId + waypoints). Layout
   * preserves these waypoints and restores them after the pipeline. Full
   * layout clears this set.
   */
  pinnedConnections?: Set<string>;
  /**
   * Which image formats to append to every mutating tool response.
   *
   * - `['png']`         — PNG only (2× resolution, cropped to diagram content)
   * - `['svg']`         — SVG only (cropped)
   * - `['png', 'svg']`  — both
   * - `true`            — shorthand for `['png']` (backward-compat)
   * - `false`/`undefined` — no images
   *
   * Set via `create_bpmn_diagram` with `includeImage`.
   */
  includeImage?: IncludeImage;
}

/** A single text item in a tool result. */
export interface TextContent {
  type: 'text';
  text: string;
}

/** A single image item in a tool result. */
export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
  /** Optional audience annotation (e.g. ["user"] to show only to humans). */
  annotations?: Record<string, unknown>;
}

/** Shape of the JSON returned by tool handlers that wrap results. */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{
    type: string;
    /** For text content items. */
    text?: string;
    /** For image content items. */
    data?: string;
    /** For image and resource_link content items. */
    mimeType?: string;
    /** For resource_link content items: the bpmn:// resource URI. */
    uri?: string;
    /** For resource_link content items: a short display name. */
    name?: string;
    /** For resource_link content items: what the resource contains. */
    description?: string;
    /** For embedded resource content items (`type: 'resource'`). */
    resource?: { uri: string; mimeType?: string; text?: string; blob?: string };
    /** Optional audience annotation. */
    annotations?: Record<string, unknown>;
  }>;
  /**
   * Machine-readable duplicate of a JSON tool result, per the MCP
   * `structuredContent` field. Additive only — `content[0].text` always
   * carries the same JSON as a string, so existing callers that do
   * `JSON.parse(result.content[0].text)` are unaffected.
   */
  structuredContent?: Record<string, unknown>;
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
