/**
 * Shared types for the ELK layout engine.
 */

import type { BpmnElement } from '../bpmn-types';

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
}

/** Result of crossing flow detection: count + pairs of crossing flow IDs. */
export interface CrossingFlowsResult {
  count: number;
  pairs: Array<[string, string]>;
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
