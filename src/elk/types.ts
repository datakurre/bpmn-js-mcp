/**
 * Shared types for the ELK layout engine.
 */

import type { LayoutOptions } from 'elkjs';
import type { BpmnElement } from '../bpmn-types';

/**
 * Typed ELK layout options for BPMN diagrams (J5).
 *
 * ELK accepts all layout options as `LayoutOptions = Record<string, string>`
 * from elkjs.  This interface documents every ELK option key used by the
 * BPMN-MCP layout engine with its accepted values and purpose, providing
 * self-documentation and IDE autocomplete for the `ELK_LAYOUT_OPTIONS`
 * constant in `src/elk/constants.ts`.
 *
 * All values are strings because ELK's API only accepts strings.  Numeric
 * values are passed as `String(n)`, booleans as `'true'` / `'false'`.
 *
 * Note: This type does not extend `LayoutOptions` to avoid TypeScript's
 * index-signature constraint (`[key: string]: string`) which prevents
 * optional narrowed-union properties.  Use `asElkLayoutOptions()` to cast
 * to `LayoutOptions` where needed for elkjs API compatibility.
 */
export interface BpmnElkOptions {
  'elk.algorithm'?: string;
  'elk.direction'?: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
  'elk.edgeRouting'?: 'ORTHOGONAL' | 'SPLINES' | 'POLYLINE' | 'UNDEFINED';
  'elk.spacing.nodeNode'?: string;
  'elk.spacing.edgeNode'?: string;
  'elk.spacing.componentComponent'?: string;
  'elk.layered.spacing.nodeNodeBetweenLayers'?: string;
  'elk.layered.spacing.edgeNodeBetweenLayers'?: string;
  'elk.layered.spacing.edgeEdgeBetweenLayers'?: string;
  'elk.layered.nodePlacement.strategy'?:
    | 'NETWORK_SIMPLEX'
    | 'BRANDES_KOEPF'
    | 'LINEAR_SEGMENTS'
    | 'SIMPLE';
  'elk.layered.nodePlacement.favorStraightEdges'?: 'true' | 'false';
  'elk.layered.crossingMinimization.strategy'?: 'LAYER_SWEEP' | 'INTERACTIVE' | 'NONE';
  'elk.layered.crossingMinimization.thoroughness'?: string;
  'elk.layered.crossingMinimization.forceNodeModelOrder'?: 'true' | 'false';
  'elk.layered.crossingMinimization.semiInteractive'?: 'true' | 'false';
  'elk.layered.cycleBreaking.strategy'?: 'DEPTH_FIRST' | 'GREEDY' | 'INTERACTIVE' | 'MODEL_ORDER';
  'elk.layered.highDegreeNodes.treatment'?: 'true' | 'false';
  'elk.layered.highDegreeNodes.threshold'?: string;
  'elk.layered.compaction.postCompaction.strategy'?: 'EDGE_LENGTH' | 'NONE' | 'CONSTRAINT_GRAPH';
  'elk.separateConnectedComponents'?: 'true' | 'false';
  'elk.layered.considerModelOrder.strategy'?: 'NODES_AND_EDGES' | 'NODES_ONLY' | 'NONE';
  'elk.priority.straightness'?: string;
  'elk.priority.direction'?: string;
  /**
   * Diagram wrapping strategy for very wide processes (A1).
   * SINGLE_EDGE / MULTI_EDGE wraps the graph into multiple rows when the
   * width exceeds a threshold.  Useful for processes with 15+ sequential
   * steps to avoid unbounded horizontal expansion.
   */
  'elk.layered.wrapping.strategy'?: 'SINGLE_EDGE' | 'MULTI_EDGE' | 'OFF';
  /**
   * Remove unnecessary bend points from ELK edge routes (A5).
   * When true, ELK eliminates redundant waypoints during the routing phase,
   * potentially reducing post-processing work in simplifyCollinearWaypoints.
   * Not currently enabled by default — could change waypoint assumptions in
   * downstream post-processing steps.
   */
  'elk.layered.unnecessaryBendpoints'?: 'true' | 'false';
  /**
   * Merge parallel edges between the same pair of nodes (A6).
   * When true, ELK combines multiple flows between the same source/target
   * into a single visual edge, reducing clutter for gateways with
   * conditional + default flows to the same target.
   */
  'elk.layered.mergeEdges'?: 'true' | 'false';
  /**
   * Native feedback (back-edge) support for loopback flows (A7).
   * When true, ELK uses its built-in feedback edge handling for backward
   * flows instead of our custom `routeLoopbacksBelow` post-processing.
   * Currently not used — custom post-processing gives better control.
   */
  'elk.layered.feedbackEdges'?: 'true' | 'false';
  /**
   * Same-layer edge-to-edge spacing in pixels (A8).
   * Controls the minimum gap between two edges routed in the same layer.
   * Could reduce the need for separateOverlappingGatewayFlows post-processing.
   */
  'elk.spacing.edgeEdge'?: string;
  /**
   * Self-loop placement distribution (A9).
   * Controls how self-loops (element connected to itself) are distributed
   * around the element's perimeter.
   * EQUALLY_DISTRIBUTED: spread evenly.
   * NORTH_SOUTH_PORT: prefer top/bottom ports.
   */
  'elk.layered.edgeRouting.selfLoopDistribution'?:
    | 'EQUALLY_DISTRIBUTED'
    | 'NORTH_SOUTH_PORT'
    | 'PREFER_SAME_PORT';
  /**
   * Native lane partitioning support (A10).
   * When true, ELK respects lane partition assignments during node placement.
   * Requires each node to have `elk.partitioning.partition` set to a lane
   * index.  Could replace the 700+ line lane post-processing in
   * `src/elk/lane-layout.ts` if fully implemented.
   */
  'elk.partitioning.activate'?: 'true' | 'false';
  /**
   * Lane partition index for a node (A10).
   * Set on individual nodes when elk.partitioning.activate is true.
   * Nodes with lower partition indices are placed in earlier (top/left) lanes.
   */
  'elk.partitioning.partition'?: string;
  /**
   * Target aspect ratio (width:height) for the layout (A11).
   * ELK adjusts layering to approach this ratio while minimising edge length.
   * Could produce more balanced layouts for display in constrained viewports.
   */
  'elk.aspectRatio'?: string;
  /**
   * Layering strategy controlling how nodes are assigned to layers (A12).
   * INTERACTIVE: preserves the existing layer assignments of pre-placed nodes —
   *   useful for scoped re-layout (scopeElementId) to avoid disrupting layers.
   * LONGEST_PATH: standard longest-path layering (often ELK's default).
   * NETWORK_SIMPLEX: minimises edge length sum (used by ELK default).
   * BF_MODEL_ORDER: breadth-first in model order.
   */
  'elk.layered.layering.strategy'?:
    | 'NETWORK_SIMPLEX'
    | 'LONGEST_PATH'
    | 'COFFMAN_GRAHAM'
    | 'DF_MODEL_ORDER'
    | 'BF_MODEL_ORDER'
    | 'INTERACTIVE'
    | 'STRETCH_WIDTH'
    | 'MIN_WIDTH';
}

/**
 * Cast a {@link BpmnElkOptions} value to `LayoutOptions` for passing to
 * elkjs functions that expect `Record<string, string>`.
 */
export function asElkLayoutOptions(opts: BpmnElkOptions): LayoutOptions {
  return opts as LayoutOptions;
}

/** Optional parameters for ELK layout. */
export interface ElkLayoutOptions {
  direction?: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
  nodeSpacing?: number;
  layerSpacing?: number;
  /** Restrict layout to a specific subprocess or participant (scope). */
  scopeElementId?: string;
  /** Pin the main (happy) path to a single row for visual clarity. */
  preserveHappyPath?: boolean;
  /**
   * Enable post-ELK grid snap pass (default: true).
   * When true, quantises node positions to a virtual grid for visual
   * regularity matching bpmn-auto-layout's aesthetic.
   * When false, preserves pure ELK positioning.
   */
  gridSnap?: boolean;
  /**
   * Simplify gateway branch routes to clean L/Z-shaped paths (default: true).
   * When false, preserves ELK's original crossing-minimised routing.
   */
  simplifyRoutes?: boolean;
  /**
   * Layout compactness preset.
   * - 'compact': tighter spacing (nodeSpacing=40, layerSpacing=50)
   * - 'spacious': generous spacing (nodeSpacing=80, layerSpacing=100)
   * Explicit nodeSpacing/layerSpacing values override compactness presets.
   */
  compactness?: 'compact' | 'spacious';
  /**
   * Lane layout strategy:
   * - 'preserve': keep lanes in their original top-to-bottom order (default)
   * - 'optimize': reorder lanes to minimise cross-lane sequence flows
   */
  laneStrategy?: 'preserve' | 'optimize';
}

/** Result of crossing flow detection: count + pairs of crossing flow IDs. */
export interface CrossingFlowsResult {
  count: number;
  pairs: Array<[string, string]>;
}

/**
 * Lane-crossing metrics: statistics about how many sequence flows
 * cross lane boundaries within participant pools.
 */
export interface LaneCrossingMetrics {
  /** Total number of sequence flows between lane-assigned elements. */
  totalLaneFlows: number;
  /** Number of those flows that cross lane boundaries. */
  crossingLaneFlows: number;
  /** IDs of the crossing flows (omitted if none). */
  crossingFlowIds?: string[];
  /** Percentage of flows staying within the same lane (0–100). Higher is better. */
  laneCoherenceScore: number;
}

/**
 * Detected layer: a group of elements sharing approximately the same
 * x-centre, representing one ELK column.
 */
export interface GridLayer {
  /** Elements in this layer. */
  elements: BpmnElement[];
  /** Leftmost x of any element in the layer. */
  minX: number;
  /** Rightmost edge (x + width) of any element in the layer. */
  maxRight: number;
  /** Maximum element width in this layer. */
  maxWidth: number;
}
