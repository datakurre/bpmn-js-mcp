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
};

/**
 * Maximum Y-centre difference (in px) for two elements to be considered
 * "same row" during the post-ELK vertical alignment snap.
 */
export const SAME_ROW_THRESHOLD = 20;

/** Padding inside compound containers (expanded subprocesses). */
export const CONTAINER_PADDING = '[top=60,left=40,bottom=60,right=40]';

/** Padding inside participant pools — extra left for the ~30px bpmn-js label band. */
export const PARTICIPANT_PADDING = '[top=80,left=50,bottom=80,right=40]';

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
