/**
 * ELK-specific constants for BPMN diagram layout.
 */

import type { BpmnElkOptions } from './types';
import {
  ELK_LAYER_SPACING,
  ELK_NODE_SPACING,
  ELK_EDGE_NODE_SPACING,
  ELK_EDGE_EDGE_BETWEEN_LAYERS_SPACING,
  ELK_EDGE_NODE_BETWEEN_LAYERS_SPACING,
} from '../constants';

/** Default ELK layout options tuned for BPMN diagrams. */
export const ELK_LAYOUT_OPTIONS: BpmnElkOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': String(ELK_NODE_SPACING),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(ELK_LAYER_SPACING),
  'elk.spacing.edgeNode': String(ELK_EDGE_NODE_SPACING),
  'elk.layered.spacing.edgeEdgeBetweenLayers': String(ELK_EDGE_EDGE_BETWEEN_LAYERS_SPACING),
  'elk.layered.spacing.edgeNodeBetweenLayers': String(ELK_EDGE_NODE_BETWEEN_LAYERS_SPACING),
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  // Treat gateways with many connections (>5 edges) specially to improve
  // routing around complex decision points.  ELK places high-degree nodes
  // into separate layers to reduce edge crossings.
  'elk.layered.highDegreeNodes.treatment': 'true',
  'elk.layered.highDegreeNodes.threshold': '5',
  // Post-layout compaction minimises total edge length, tightening the
  // layout without changing the layering or ordering.
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
  // Separate disconnected sub-graphs into independent layout groups (A4).
  // For fully-connected BPMN diagrams this has no effect; for diagrams with
  // disconnected elements (e.g. unlinked text annotations or orphaned tasks)
  // it places each connected component as a distinct block instead of
  // mixing them into a single layout graph.
  'elk.separateConnectedComponents': 'true',
  // Minimum gap (px) between independently-laid-out connected components.
  'elk.spacing.componentComponent': '50',
};

/**
 * Maximum Y-centre difference (in px) for two elements to be considered
 * "same row" during the post-ELK vertical alignment snap.
 */
export const SAME_ROW_THRESHOLD = 20;

/** Padding inside compound containers (expanded subprocesses). */
export const CONTAINER_PADDING = '[top=60,left=40,bottom=60,right=50]';

/** Padding inside event subprocesses (reduced to fit compact interrupt/non-interrupt handlers). */
export const EVENT_SUBPROCESS_PADDING = '[top=40,left=32,bottom=40,right=32]';

/** Padding inside participant pools — extra left for the ~30px bpmn-js label band. */
export const PARTICIPANT_PADDING = '[top=80,left=50,bottom=80,right=40]';

/**
 * Padding inside participant pools that contain lanes.
 * Lanes have their own ~30px label band on the left, so elements need
 * to be pushed further right: pool label band (30) + lane label band (30)
 * + breathing room (20) = 80px total left padding.
 */
export const PARTICIPANT_WITH_LANES_PADDING = '[top=80,left=80,bottom=80,right=40]';

/** Offset from origin so the diagram has comfortable breathing room.
 *
 * ORIGIN_OFFSET_X / ORIGIN_OFFSET_Y are the ELK coordinate mapping
 * offsets used in applyElkPositions and applyEdgeRoutes.  They place the
 * raw ELK output starting at (ORIGIN_OFFSET_X, ORIGIN_OFFSET_Y).
 *
 * NORMALISE_ORIGIN_Y is used by normaliseOrigin() to re-anchor the final
 * diagram so the topmost plain-process element sits at this Y value.
 * 92 matches Camunda Modeler's default top margin for plain processes,
 * producing 12px more breathing room than the raw ELK output (y=80).
 * Collaborations skip normaliseOrigin entirely — their pool positions are
 * anchored by centreElementsInPools + enforceExpandedPoolGap.
 *
 * NORMALISE_BOUNDARY_ORIGIN_Y is the equivalent target for processes that
 * contain boundary events.  Camunda Modeler places the topmost flow element
 * 13px lower in these diagrams (y=105 vs y=92) to give more visual space
 * for boundary event labels and exception-path flows below the main row.
 */
export const ORIGIN_OFFSET_X = 180;
export const ORIGIN_OFFSET_Y = 80;
export const NORMALISE_ORIGIN_Y = 94;
export const NORMALISE_BOUNDARY_ORIGIN_Y = 105;

/**
 * Large displacement threshold (px) for normaliseOrigin().
 *
 * When the topmost element is MORE than this many pixels below NORMALISE_ORIGIN_Y,
 * it signals ELK placed the entire layout far too low (e.g. due to gateway port
 * constraints reserving a virtual upper row).  In that case normaliseOrigin()
 * shifts everything up to NORMALISE_ORIGIN_Y.
 *
 * Must be larger than the natural ELK top-margin variation (≈20px for processes
 * with boundary events or parallel gateways) and smaller than the artificial
 * displacement (≈56–130px for layouts with SOUTH-port gateways).  40px works
 * for all current reference fixtures.
 */
export const NORMALISE_LARGE_THRESHOLD = 40;

/**
 * Tolerance (px) for snapping near-orthogonal segments to strict orthogonal.
 * Covers ELK rounding offsets and gateway port placement differences.
 */
export const ORTHO_SNAP_TOLERANCE = 15;

/** Default vertical offset (px) below the flow for data objects/stores. */
export const ARTIFACT_BELOW_OFFSET = 80;
/** Default vertical offset (px) above the flow for text annotations. */
export const ARTIFACT_ABOVE_OFFSET = 80;

// ── Happy-path alignment ────────────────────────────────────────────────

/**
 * Maximum Y-centre correction (px) for happy-path wobble.
 * Larger deviations indicate the element is on a different branch.
 */
export const MAX_WOBBLE_CORRECTION = 20;

/**
 * Extended Y-correction threshold (px) for imported diagrams where
 * fork-join patterns pull elements away from the happy-path row.
 */
export const MAX_EXTENDED_CORRECTION = 200;

/**
 * X-centre proximity (px) for two elements to be in the same column.
 * Used by alignHappyPath to identify column-mates.
 */
export const COLUMN_PROXIMITY = 30;

// ── ELK graph construction ──────────────────────────────────────────────

/**
 * Y-range threshold (px) to classify a container as having DI-imported
 * coordinates (diverse Y).  Imported BPMNs span hundreds of pixels;
 * programmatically created diagrams cluster within ~80-100px.
 */
export const DIVERSE_Y_THRESHOLD = 100;

/**
 * ELK priority for happy-path edges (straightness + direction) and
 * split-gateway shortness.  Must be noticeably higher than default (0)
 * to dominate NETWORK_SIMPLEX decisions.
 */
export const ELK_HIGH_PRIORITY = '10';

// ── Spacing helpers ─────────────────────────────────────────────────────

/** Extra gap (px) added between event↔task layers for breathing room. */
export const EVENT_TASK_GAP_EXTRA = 0;

/**
 * Extra gap (px) added after a layer containing a boundary-event host.
 *
 * Tasks with attached boundary events need extra horizontal space to
 * accommodate the boundary event targets placed below.  Reference
 * layouts (Camunda Modeler) use 80–87px edge-to-edge after such tasks
 * vs the normal 60–65px.  This constant closes the gap.
 */
export const BOUNDARY_HOST_GAP_EXTRA = 10;

/**
 * Extra gap (px) added between gateway↔task layers.
 * Gateways (50px) are narrower than tasks (100px).  With equal edge-to-edge
 * gaps the visual spacing looks tighter; the reference layouts use ~5px more
 * breathing room for gateway↔task transitions.
 */
export const GATEWAY_TASK_GAP_EXTRA = 5;

/** Gap reduction (px) between gateway↔event layers (both compact shapes). */
export const GATEWAY_EVENT_GAP_REDUCE = 5;

/**
 * Extra gap (px) between consecutive gateway layers.
 * Gateway-to-gateway transitions (e.g. exclusive merge → parallel split)
 * need more breathing room because both shapes are compact (50px).
 * Reference layouts consistently use ~70px for these transitions.
 */
export const GATEWAY_GATEWAY_GAP_EXTRA = 10;

/**
 * Gap (px) between the bottom of the last expanded pool and the first
 * collapsed pool.
 */
export const COLLAPSED_POOL_GAP = 50;

/**
 * Extra vertical spacing (px) added between participant pools in
 * collaboration diagrams.  ELK's default nodeNode spacing is too tight
 * for pools — the reference uses ≈58 px edge-to-edge between pools.
 *
 * Set to 68 (not 58) to compensate for a 10 px bpmn-js auto-resize side
 * effect: when pool contents are moved by centreElementsInPools, bpmn-js
 * silently expands the pool height by ~10 px in the serialised DI, so the
 * elementRegistry height (used during gap enforcement) understates the
 * final pool height.  The extra 10 px corrects for that offset so that
 * the serialised gap matches the reference (~58 px).
 */
export const INTER_POOL_GAP_EXTRA = 68;

// ── Edge routing ────────────────────────────────────────────────────────

/**
 * Tolerance (px) for snapping near-orthogonal segments within edge routes.
 * Covers ELK rounding and gateway port placement offsets.
 */
export const SEGMENT_ORTHO_SNAP = 8;

/**
 * Maximum distance (px) for an endpoint to be considered disconnected
 * from its source/target element boundary.
 */
export const DISCONNECT_THRESHOLD = 20;

/**
 * Minimum Y-difference (px) between source and target for a gateway
 * branch route to qualify as a different-row connection.
 */
export const DIFFERENT_ROW_THRESHOLD = 10;

// ── Movement guards ─────────────────────────────────────────────────────

/**
 * Minimum Y-delta (px) to justify moving an element during alignment.
 * Prevents churn from sub-pixel rounding.
 */
export const MIN_MOVE_THRESHOLD = 2;

// ── Artifact positioning constants ──────────────────────────────────────

/** Minimum Y-distance (px) below flow elements for data objects/stores. */
export const ARTIFACT_BELOW_MIN = 80;

/** Minimum Y-distance (px) above flow elements for text annotations. */
export const ARTIFACT_ABOVE_MIN = 150;

/** Padding (px) around artifacts when checking for overlaps. */
export const ARTIFACT_PADDING = 20;

/** Negative padding for left-side artifact placement. */
export const ARTIFACT_NEGATIVE_PADDING = -20;

/** Vertical search height (px) when finding space for artifacts. */
export const ARTIFACT_SEARCH_HEIGHT = 200;

// ── Element sizing constants ────────────────────────────────────────────

/** Standard BPMN task width (px). */
export const BPMN_TASK_WIDTH = 100;

/** Standard BPMN task height (px). */
export const BPMN_TASK_HEIGHT = 80;

/** Standard BPMN dummy/placeholder node height (px) for ELK graph. */
export const BPMN_DUMMY_HEIGHT = 30;

/** Standard BPMN event diameter (px). */
export const BPMN_EVENT_SIZE = 36;

/** Default width (px) for compound containers (pools, subprocesses) when not specified. */
export const CONTAINER_DEFAULT_WIDTH = 300;

/** Default height (px) for compound containers (pools, subprocesses) when not specified. */
export const CONTAINER_DEFAULT_HEIGHT = 200;

// ── Layout positioning constants ────────────────────────────────────────

/** Factor for calculating element center X/Y (0.5 = middle). */
export const CENTER_FACTOR = 0.5;

/** Start position X-offset (px) from ELK origin. */
export const START_OFFSET_X = 20;

/** Start position Y-offset (px) from ELK origin. */
export const START_OFFSET_Y = 50;

// ── Gateway split factors ───────────────────────────────────────────────

/**
 * Gateway vertical split factor for branch positioning.
 * 0.67 ≈ 2/3 along the gateway height for upper branch.
 */
export const GATEWAY_UPPER_SPLIT_FACTOR = 0.67;

// ── Proximity and tolerance thresholds ──────────────────────────────────

/** Minimum movement threshold (px) to trigger element repositioning. */
export const MOVEMENT_THRESHOLD = 0.5;

// ── Boundary event positioning constants ────────────────────────────────

/** Y-distance buffer (px) for boundary event target row qualification. */
export const BOUNDARY_TARGET_ROW_BUFFER = 10;

/**
 * Fraction of host width/height used as margin on each side when
 * spreading multiple boundary events along the same border.
 * 0.1 = 10% margin → events occupy the middle 80% of the border.
 */
export const BOUNDARY_SPREAD_MARGIN_FACTOR = 0.1;

// ── Edge routing — local constants promoted from inline values ──────────

/**
 * Tolerance (px) for snapping edge endpoints to element boundaries.
 * Covers gaps introduced by grid snap moving elements after ELK routing.
 */
export const ENDPOINT_SNAP_TOLERANCE = 15;

/**
 * Tolerance (px) for snapping flow endpoints to element centre lines.
 * Only adjusts endpoints within this distance on the cross-axis.
 */
export const CENTRE_SNAP_TOLERANCE = 15;

/**
 * Minimum Y-centre difference (px) for two elements to be considered
 * "on a different row" in route rebuilding and simplification.
 */
export const DIFFERENT_ROW_MIN_Y = 15;

/**
 * Y-centre proximity (px) for treating source and target as "same row"
 * in disconnected-edge straight-flow rebuilding.
 */
export const SAME_ROW_Y_TOLERANCE = 5;

/**
 * X-centre proximity (px) for two branch targets to be considered
 * "in the same layer" during gateway branch symmetrisation.
 */
export const SAME_LAYER_X_THRESHOLD = 50;

// ── Boundary event target positioning ───────────────────────────────────

/**
 * Distance (px) from boundary event's host bottom edge to the
 * boundary leaf target's centre Y.
 */
export const BOUNDARY_TARGET_Y_OFFSET = 85;

/** Distance (px) from boundary event centre X to its leaf target centre X. */
export const BOUNDARY_TARGET_X_OFFSET = 90;

/**
 * Proximity tolerance (px) for deciding if a boundary event needs
 * repositioning relative to its host.
 */
export const BOUNDARY_PROXIMITY_TOLERANCE = 60;

// ── Channel routing constants ───────────────────────────────────────────

/**
 * X-proximity (px) of a vertical segment to the gateway centre X
 * to qualify as a gateway branch vertical segment for channel routing.
 */
export const CHANNEL_GW_PROXIMITY = 40;

/** Minimum channel width (px) for meaningful channel routing. */
export const MIN_CHANNEL_WIDTH = 30;

/** Fraction of channel width used as margin on each side (0.2 = 20%). */
export const CHANNEL_MARGIN_FACTOR = 0.2;

// ── Edge route simplification constants ─────────────────────────────────

/**
 * Maximum deviation (px) for a waypoint to be considered a micro-bend.
 *
 * Three consecutive waypoints that are nearly collinear — all Y values
 * within this threshold (horizontal) or all X values within this threshold
 * (vertical) — indicate a "wiggle" caused by ELK rounding, grid snap, or
 * post-processing.  The middle point is removed to produce a cleaner route.
 */
export const MICRO_BEND_TOLERANCE = 5;

/**
 * Maximum length (px) of a short orthogonal segment to be merged.
 *
 * An H-V-H or V-H-V staircase where the middle segment is shorter than
 * this threshold is flattened into a single straight segment by snapping
 * the two surrounding bend points to the same axis.
 */
export const SHORT_SEGMENT_THRESHOLD = 6;

// ── Edge route repair constants ───────────────────────────────────────

/** Vertical offset (px) for rerouting overlapping collinear flows. */
export const COLLINEAR_DETOUR_OFFSET = 20;

/** Vertical margin (px) below the lowest element for loopback routing. */
export const LOOPBACK_BELOW_MARGIN = 30;

/** Horizontal margin (px) outside source/target for loopback vertical segments. */
export const LOOPBACK_HORIZONTAL_MARGIN = 15;

// ── Lane layout constants ───────────────────────────────────────────────

/** Minimum lane height (px) inside a participant pool. */
export const MIN_LANE_HEIGHT = 250;

/** Left label band width (px) inside a participant pool. */
export const POOL_LABEL_BAND = 30;

/** Vertical padding (px) above/below content within each lane band. */
export const LANE_VERTICAL_PADDING = 30;

// ── Overlap resolution constants ────────────────────────────────────────

/** Minimum gap (px) enforced between elements after overlap resolution. */
export const MIN_OVERLAP_GAP = 30;

/** Maximum iterations for the overlap resolution pass. */
export const OVERLAP_MAX_ITERATIONS = 5;

// ── Position application constants ──────────────────────────────────────

/**
 * Significance threshold (px) for element resize and repositioning.
 * Changes below this threshold are skipped to avoid sub-pixel churn.
 */
export const RESIZE_SIGNIFICANCE_THRESHOLD = 5;

/** Default height (px) for collapsed participant pools when not specified. */
export const COLLAPSED_POOL_DEFAULT_HEIGHT = 60;

/**
 * Right-side padding (px) for post-layout pool width compaction.
 * After ELK layout + grid snap, pools may be wider than necessary.
 * This pass shrinks the pool's right edge to hug the rightmost
 * flow element with this much breathing room.
 */
export const POOL_COMPACT_RIGHT_PADDING = 50;

// ── Subprocess alignment constants ──────────────────────────────────────

/**
 * Y-centre threshold (px) for grouping elements into the same row
 * within expanded subprocesses.  More generous than the top-level
 * SAME_ROW_THRESHOLD because subprocesses have tighter spacing.
 */
export const SUBPROCESS_ROW_THRESHOLD = 40;

// ── Graph builder constants ─────────────────────────────────────────────

/** Maximum trace depth for synthetic ordering edges in gateway analysis. */
export const MAX_TRACE_DEPTH = 15;

// ── Subset layout constants ─────────────────────────────────────────────

/**
 * Y-centre proximity (px) for two endpoints to be considered "same row"
 * when rebuilding neighbor edges in subset (partial) layout.
 *
 * Distinct from SAME_ROW_THRESHOLD (used for vertical snap) and
 * SAME_ROW_Y_TOLERANCE (used for straight-flow detection in edge repair).
 * This value is intentionally smaller than SAME_ROW_THRESHOLD because
 * neighbor edges in a subset layout have already been snapped and should
 * only be straightened when the endpoints are very close to co-linear.
 */
export const SUBSET_NEIGHBOR_SAME_ROW_THRESHOLD = 15;

// ── Self-loop routing constants ─────────────────────────────────────────

/**
 * Horizontal margin (px) beyond the element's right edge for self-loop routing.
 * The self-loop exits the right side, extends this far right, then loops below.
 */
export const SELF_LOOP_MARGIN_H = 35;

/**
 * Vertical margin (px) below the element's bottom edge for self-loop routing.
 * The loop descends this far below the element before turning back.
 */
export const SELF_LOOP_MARGIN_V = 35;

// ── ELK algorithm tuning ───────────────────────────────────────────────

/**
 * ELK crossing minimisation thoroughness.
 * Higher values produce fewer edge crossings at the cost of layout time.
 */
export const ELK_CROSSING_THOROUGHNESS = '30';
