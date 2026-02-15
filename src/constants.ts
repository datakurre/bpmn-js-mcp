/**
 * Centralised magic numbers and element-size constants.
 *
 * Keeps layout-related values in one place so changes propagate
 * consistently across all handlers that do positioning / spacing.
 */

/** Standard edge-to-edge gap in pixels between BPMN elements. */
export const STANDARD_BPMN_GAP = 50;

/**
 * ELK-specific spacing constants.
 *
 * Tuned to match bpmn-js's built-in auto-place spacing (~58px average
 * edge-to-edge gaps, ~110px vertical branch separation).  Kept separate
 * from STANDARD_BPMN_GAP which is used for auto-positioning in
 * add-element.ts and connection routing fallbacks.
 */
export const ELK_LAYER_SPACING = 60;
export const ELK_NODE_SPACING = 50;
export const ELK_EDGE_NODE_SPACING = 15;

/**
 * Spacing (px) between parallel edges running between layers.
 *
 * ELK default is 10, but BPMN diagrams benefit from slightly more
 * breathing room to avoid overlapping labels and crowded branch routes.
 */
export const ELK_EDGE_EDGE_BETWEEN_LAYERS_SPACING = 15;

/**
 * Spacing (px) between edges and nodes in adjacent layers.
 *
 * Prevents edge routes from hugging too close to unrelated nodes.
 * ELK default is 10; a modest increase reduces visual clutter.
 */
export const ELK_EDGE_NODE_BETWEEN_LAYERS_SPACING = 15;

/**
 * Tighter edge-to-edge gap (px) between elements that are all branches
 * of the same gateway (parallel fork-join pattern).
 *
 * Reference layouts use 110px centre-to-centre for 80px-tall tasks,
 * i.e. 30px edge-to-edge.  The general ELK_NODE_SPACING (50px) is too
 * wide for this pattern.  Only applied when every element in a layer
 * shares the same source or target gateway.
 */
export const ELK_BRANCH_NODE_SPACING = 30;

/**
 * Edge-to-edge gap (px) between a happy-path element and a boundary
 * sub-flow target in the same layer.
 *
 * Reference layouts place boundary exception paths ~40px edge-to-edge
 * below the main flow (120px centre-to-centre for 80px-tall tasks).
 * Tighter than general ELK_NODE_SPACING but looser than gateway branches.
 */
export const ELK_BOUNDARY_NODE_SPACING = 40;

export const ELK_COMPACT_NODE_SPACING = 40;
export const ELK_SPACIOUS_NODE_SPACING = 80;
export const ELK_COMPACT_LAYER_SPACING = 50;
export const ELK_SPACIOUS_LAYER_SPACING = 100;

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

/** Look up the default size for a given BPMN element type string. */
// ── Label positioning constants ────────────────────────────────────────────

/** Distance between element edge and external label. */
export const ELEMENT_LABEL_DISTANCE = 10;

/**
 * Extra distance for labels placed below events.
 * Set to 0 for optimal visual spacing — event labels use only
 * ELEMENT_LABEL_DISTANCE for their bottom gap.
 */
export const ELEMENT_LABEL_BOTTOM_EXTRA = 0;

/** Default external label dimensions (matches bpmn-js). */
export const DEFAULT_LABEL_SIZE = { width: 90, height: 20 };

/**
 * Default label position priority (top first).
 * Used for gateways and data objects/stores where top is preferred.
 */
export const LABEL_POSITION_PRIORITY: readonly ('top' | 'bottom' | 'left' | 'right')[] = [
  'top',
  'bottom',
  'left',
  'right',
];

/**
 * Label position priority for events (start, end, intermediate).
 * Events prefer bottom labels because their connections typically exit
 * left/right, leaving the bottom clear.  bpmn-js places event labels
 * below by default.
 */
export const EVENT_LABEL_POSITION_PRIORITY: readonly ('top' | 'bottom' | 'left' | 'right')[] = [
  'bottom',
  'top',
  'left',
  'right',
];

/**
 * Label position priority for boundary events.
 * Boundary events have outgoing flows that exit downward from the bottom
 * of the event, so 'bottom' labels would overlap the first vertical
 * segment of the outgoing flow.  Prefer 'left' to avoid this clash.
 */
export const BOUNDARY_EVENT_LABEL_POSITION_PRIORITY: readonly (
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
)[] = ['left', 'bottom', 'right', 'top'];

/**
 * Extra scoring penalty when a label candidate overlaps connection
 * segments that are directly attached to the label's own element.
 * Higher than the generic +1 crossing penalty because own-flow overlap
 * is systematic (the flow always exits near the element) rather than
 * coincidental.
 */
export const OWN_FLOW_CROSSING_PENALTY = 4;

/** Indent offset for flow (connection) labels from midpoint (matches bpmn-js). */
export const FLOW_LABEL_INDENT = 15;

/**
 * Rendered length (px) of the sequence flow arrow head marker.
 *
 * bpmn-js defines the arrow as a `<marker>` with `viewBox="0 0 20 20"`,
 * `markerWidth="10"`, `markerHeight="10"` and a path `M 1 5 L 11 10 L 1 15 Z`.
 * At half-scale the rendered arrow spans ~5 px.  Subtracting this from the
 * effective flow length before computing the label midpoint makes labels
 * appear visually centred on the *visible* part of the connection line.
 */
export const ARROW_HEAD_LENGTH = 5;

/**
 * Proximity margin (px) for label-to-shape distance scoring.
 * Labels within this distance of a shape receive a proximity penalty
 * even when they don't overlap, improving readability.
 */
export const LABEL_SHAPE_PROXIMITY_MARGIN = 10;

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
  if (elementType === 'bpmn:TextAnnotation') return ELEMENT_SIZES.textAnnotation;
  if (elementType === 'bpmn:DataObjectReference') return ELEMENT_SIZES.dataObject;
  if (elementType === 'bpmn:DataStoreReference') return ELEMENT_SIZES.dataStore;
  if (elementType === 'bpmn:Group') return ELEMENT_SIZES.group;
  if (elementType.includes('Task') || elementType === 'bpmn:CallActivity') {
    return ELEMENT_SIZES.task;
  }
  return ELEMENT_SIZES.default;
}
