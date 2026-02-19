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
