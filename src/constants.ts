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
 * Matches the spacing the rebuild layout engine produces between layers
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

// ── Rebuild layout engine constants ───────────────────────────────────────

/**
 * Default origin for the first start event (center coordinates).
 * Used as a fallback when no predecessor position is known.
 */
export const DEFAULT_ORIGIN = { x: 180, y: 200 };

/**
 * Default vertical centre-to-centre spacing between gateway branches.
 * Matches typical BPMN layout: task height (80) + standard gap (50).
 */
export const DEFAULT_BRANCH_SPACING = 130;

/**
 * Padding (px) inside an expanded subprocess around its internal elements.
 *
 * Applied on all four sides when resizing a subprocess to fit its contents
 * during layout.  Uses 40px (larger than SUBPROCESS_INNER_PADDING) to leave
 * extra room for the subprocess label/title bar at the top.
 */
export const SUBPROCESS_LAYOUT_PADDING = 40;

/**
 * Gap (px) between stacked participant pools in a collaboration.
 *
 * Chosen via visual testing to provide comfortable whitespace between
 * vertically stacked pools without leaving too much empty space.
 */
export const POOL_GAP = 68;

/**
 * Grid size (pixels) used for element left-edge position snapping.
 *
 * Snapping left edges (rather than centres) ensures that the visible
 * top-left corner of each element lands on a predictable grid.
 * Matches bpmn-js's default grid-snapping module setting.
 */
export const POSITION_GRID = 10;

/**
 * Gap (px) between a connection segment and the nearest edge of the flow label box.
 *
 * Used when placing labels perpendicular to their associated segment.
 * Kept small (5px) so labels are visually close to the line they annotate.
 */
export const FLOW_LABEL_SIDE_OFFSET = 5;

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
