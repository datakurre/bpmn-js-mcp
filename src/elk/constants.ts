/**
 * ELK-specific constants for BPMN diagram layout.
 */

import type { LayoutOptions } from 'elkjs';
import { ELK_LAYER_SPACING, ELK_NODE_SPACING, ELK_EDGE_NODE_SPACING } from '../constants';

/** Default ELK layout options tuned for BPMN diagrams. */
export const ELK_LAYOUT_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': String(ELK_NODE_SPACING),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(ELK_LAYER_SPACING),
  'elk.spacing.edgeNode': String(ELK_EDGE_NODE_SPACING),
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
};

/**
 * Maximum Y-centre difference (in px) for two elements to be considered
 * "same row" during the post-ELK vertical alignment snap.
 */
export const SAME_ROW_THRESHOLD = 20;

/** Padding inside compound containers (expanded subprocesses). */
export const CONTAINER_PADDING = '[top=60,left=40,bottom=60,right=50]';

/** Padding inside participant pools — extra left for the ~30px bpmn-js label band. */
export const PARTICIPANT_PADDING = '[top=80,left=50,bottom=80,right=40]';

/**
 * Padding inside participant pools that contain lanes.
 * Lanes have their own ~30px label band on the left, so elements need
 * to be pushed further right: pool label band (30) + lane label band (30)
 * + breathing room (20) = 80px total left padding.
 */
export const PARTICIPANT_WITH_LANES_PADDING = '[top=80,left=80,bottom=80,right=40]';

/** Offset from origin so the diagram has comfortable breathing room. */
export const ORIGIN_OFFSET_X = 180;
export const ORIGIN_OFFSET_Y = 80;

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

/** Gap reduction (px) between gateway↔event layers (both compact shapes). */
export const GATEWAY_EVENT_GAP_REDUCE = 5;

/**
 * Gap (px) between the bottom of the last expanded pool and the first
 * collapsed pool.
 */
export const COLLAPSED_POOL_GAP = 50;

/**
 * Extra vertical spacing (px) added between participant pools in
 * collaboration diagrams.  ELK's default nodeNode spacing is too tight
 * for pools — the reference uses ≈60 px edge-to-edge between pools.
 */
export const INTER_POOL_GAP_EXTRA = 60;

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

/** Minimum Y-movement (px) to trigger boundary event repositioning. */
export const BOUNDARY_MIN_MOVE_DELTA = 0.1;

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
