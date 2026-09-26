/**
 * Centralised magic numbers and element-size constants.
 *
 * Keeps layout-related values in one place so changes propagate
 * consistently across all handlers that do positioning / spacing.
 */

/** Standard edge-to-edge gap in pixels between BPMN elements. */
export const STANDARD_BPMN_GAP = 50;

/**
 * Inter-layer spacing (px) used when inserting elements into existing flows.
 *
 * Matches the spacing `bpmn-auto-layout` produces between layers
 * (left-to-right), ensuring inserted elements align with the surrounding
 * layout.
 */
export const LAYER_SPACING = 60;

/**
 * Default element sizes used for layout calculations.
 *
 * These mirror the bpmn-js defaults for each element category.
 */
export const ELEMENT_SIZES: Readonly<Record<string, { width: number; height: number }>> = {
  task: { width: 100, height: 80 },
  event: { width: 36, height: 36 },
  gateway: { width: 50, height: 50 },
  subprocess: { width: 350, height: 200 },
  participant: { width: 600, height: 250 },
  textAnnotation: { width: 100, height: 30 },
  dataObject: { width: 36, height: 50 },
  dataStore: { width: 50, height: 50 },
  group: { width: 300, height: 200 },
  default: { width: 100, height: 80 },
};

// ── Label positioning constants ────────────────────────────────────────────

/** Distance between element edge and external label. */
export const ELEMENT_LABEL_DISTANCE = 10;

/** Default external label dimensions (matches bpmn-js). */
export const DEFAULT_LABEL_SIZE = { width: 90, height: 20 };

// ── Pool/lane sizing utilities ─────────────────────────────────────────────

/** Minimum pool width in pixels. */
export const MIN_POOL_WIDTH = 350;

/** Pixels per element for pool width estimation. */
export const WIDTH_PER_ELEMENT = 150;

/** Minimum lane height in pixels (for auto-sizing). */
export const MIN_LANE_HEIGHT = 120;

/** Default pool height per lane row (when creating lanes). */
export const HEIGHT_PER_LANE = 150;

/** Minimum pool height in pixels. */
export const MIN_POOL_HEIGHT = 250;

/**
 * Minimum padding (px) inside expanded subprocesses around their child elements.
 *
 * When auto-sizing subprocesses, the subprocess bounds should be at least
 * `innerElementExtent + SUBPROCESS_INNER_PADDING` on each side.
 */
export const SUBPROCESS_INNER_PADDING = 30;

/**
 * Pool aspect ratio range for readability.
 *
 * Pools with a width:height ratio below MIN_POOL_ASPECT_RATIO look too tall/narrow,
 * and above MAX_POOL_ASPECT_RATIO look too wide/short. The autosize tool can
 * optionally enforce these bounds.
 */
export const MIN_POOL_ASPECT_RATIO = 3;
export const MAX_POOL_ASPECT_RATIO = 5;

// ── Layout constants ──────────────────────────────────────────────────────

/**
 * Gap (px) between a connection segment and the nearest edge of the flow label box.
 *
 * Used when placing labels perpendicular to their associated segment.
 * Set to 10px to provide enough clearance from the line on vertical segments
 * of Z-shaped cross-lane connections (the previous value of 5px left almost
 * no visible gap between the label edge and the connection line).
 *
 * **Note — divergence from bpmn-js horizontal equivalence:**
 *   The former value of 5px coincidentally produced the same label centre Y
 *   as bpmn-js's `FLOW_LABEL_INDENT = 15` for horizontal segments with a
 *   20px label height:
 *     our centre Y = midY − 5 − 10 = midY − 15 = midY − FLOW_LABEL_INDENT  ✓
 *   With FLOW_LABEL_SIDE_OFFSET = 10 this equivalence no longer holds for
 *   horizontal segments (our centre Y = midY − 20 vs. bpmn-js midY − 15).
 *   This is intentional: for Z-shaped cross-lane connections the extra gap
 *   matters more than pixel-perfect parity with bpmn-js's horizontal offset.
 */
export const FLOW_LABEL_SIDE_OFFSET = 10;

/**
 * Flow label indent (px) — matches bpmn-js `FLOW_LABEL_INDENT = 15` from
 * `lib/util/LabelUtil.js`.
 *
 * In bpmn-js this is the distance from the segment **centre point** to the
 * label **centre**:
 *   - Horizontal: label centre Y = midY − FLOW_LABEL_INDENT
 *   - Vertical:   label centre X = midX + FLOW_LABEL_INDENT
 *
 * **Vertical segments** (intentional divergence):
 *   bpmn-js centres the label FLOW_LABEL_INDENT px from the segment, meaning
 *   the label *straddles* the segment for a 90 px wide label.  Our
 *   implementation instead places the label's nearest edge FLOW_LABEL_SIDE_OFFSET px
 *   from the segment so the label never overlaps the connection line.
 *
 * **Horizontal segments:**
 *   When FLOW_LABEL_SIDE_OFFSET was 5, our formula coincidentally matched
 *   bpmn-js:  midY − 5 − labelH/2 = midY − 5 − 10 = midY − 15 = midY − FLOW_LABEL_INDENT.
 *   With FLOW_LABEL_SIDE_OFFSET = 10 the horizontal centre Y is midY − 20,
 *   which diverges from bpmn-js by 5px.  FLOW_LABEL_INDENT is kept at 15
 *   for reference / vertical-segment usage only.
 */
export const FLOW_LABEL_INDENT = 15;

/**
 * Calculate optimal pool dimensions based on element count and lane count.
 *
 * Width formula:  `max(1200, elementCount × 150)`
 * Height formula: `max(250, laneCount × 150)`
 *
 * When no elements exist yet (e.g. at creation time), uses the lane count to
 * estimate a reasonable default width (each lane will hold ~4 elements on
 * average, so width ≈ laneCount × 4 × 150 / laneCount = 600 minimum).
 *
 * @param elementCount  Number of flow elements (tasks, events, gateways)
 * @param laneCount     Number of lanes (0 if no lanes)
 * @param nestingDepth  Maximum subprocess nesting depth (0 if flat)
 */
export function calculateOptimalPoolSize(
  elementCount: number = 0,
  laneCount: number = 0,
  nestingDepth: number = 0
): { width: number; height: number } {
  // Width: at least 1200, scale with element count
  const nestingMultiplier = 1 + nestingDepth * 0.3;
  const baseWidth = Math.max(1200, elementCount * WIDTH_PER_ELEMENT);
  const width = Math.ceil((baseWidth * nestingMultiplier) / 10) * 10;

  // Height: scale with lane count, minimum 250
  const laneHeight = laneCount > 0 ? laneCount * HEIGHT_PER_LANE : MIN_POOL_HEIGHT;
  const height = Math.max(MIN_POOL_HEIGHT, Math.ceil(laneHeight / 10) * 10);

  return { width, height };
}

// ── Element size helpers ───────────────────────────────────────────────────

export function getElementSize(elementType: string): { width: number; height: number } {
  if (elementType.includes('Gateway')) return ELEMENT_SIZES.gateway;
  if (elementType.includes('Event')) return ELEMENT_SIZES.event;
  if (elementType === 'bpmn:SubProcess') return ELEMENT_SIZES.subprocess;
  if (elementType === 'bpmn:Participant') return ELEMENT_SIZES.participant;
  if (elementType === 'bpmn:Lane') return { width: 600, height: 150 };
  if (elementType === 'bpmn:TextAnnotation') return ELEMENT_SIZES.textAnnotation;
  if (elementType === 'bpmn:DataObjectReference') return ELEMENT_SIZES.dataObject;
  if (elementType === 'bpmn:DataStoreReference') return ELEMENT_SIZES.dataStore;
  if (elementType === 'bpmn:Group') return ELEMENT_SIZES.group;
  if (elementType.includes('Task') || elementType === 'bpmn:CallActivity') {
    return ELEMENT_SIZES.task;
  }
  return ELEMENT_SIZES.default;
}

// ── Large-diagram resource-link thresholds (ADR-023) ───────────────────────

/**
 * export_bpmn: inline XML content beyond this many characters is replaced
 * with a `bpmn://diagram/{id}/xml` resource_link + short summary, unless
 * `inline: true` is passed.
 */
export const LARGE_XML_CHARS = 20_000;

/**
 * export_bpmn: inline SVG content beyond this many characters is replaced
 * with a `bpmn://diagram/{id}/svg` resource_link + short summary. SVG runs
 * roughly 3-4x more verbose per element than XML (per-element style
 * attributes, hit-test rects, marker defs with unique ids) — a modest
 * ~20-element diagram with a few lanes already produces 20,000-30,000
 * characters of SVG, so this needs its own, higher threshold rather than
 * reusing `LARGE_XML_CHARS`.
 */
export const LARGE_SVG_CHARS = 100_000;

/**
 * list_bpmn_elements / list_bpmn_process_variables: beyond this many
 * entries, the full list is replaced with a resource_link + short summary,
 * unless `inline: true` is passed.
 */
export const LARGE_LIST_COUNT = 60;
