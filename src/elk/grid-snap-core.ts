/**
 * Post-ELK grid snap pass — core functions.
 *
 * Quantises node coordinates to a virtual grid after ELK positioning,
 * combining ELK's optimal topology with bpmn-auto-layout's visual
 * regularity.
 */

import { ELK_LAYER_SPACING, ELK_NODE_SPACING } from '../constants';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { isConnection, isLayoutableShape } from './helpers';
import { EVENT_TASK_GAP_EXTRA, GATEWAY_EVENT_GAP_REDUCE } from './constants';
import type { GridLayer } from './types';
import {
  centreGatewaysOnBranches,
  symmetriseGatewayBranches,
  alignBoundarySubFlowEndEvents,
} from './grid-snap-alignment';

/**
 * Detect discrete layers (columns) from element x-positions.
 *
 * After ELK positioning and snapSameLayerElements(), elements in the
 * same ELK layer share approximately the same x-centre.  This function
 * groups them into discrete layers by clustering x-centres.
 *
 * Only considers direct children of the given container (or the root
 * process when no container is given).  This prevents mixing elements
 * from different nesting levels (e.g. subprocess internals with top-level
 * elements), which would cause cascading moves via modeling.moveElements.
 */
export function detectLayers(
  elementRegistry: ElementRegistry,
  container?: BpmnElement
): GridLayer[] {
  // When no container is specified, find the root process element so we
  // only include its direct children — not children of subprocesses.
  let parentFilter: BpmnElement | undefined = container;
  if (!parentFilter) {
    parentFilter = elementRegistry.filter(
      (el) => el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration'
    )[0];
  }

  // If no root found (shouldn't happen), fall back to including all elements
  if (!parentFilter) {
    const shapes = elementRegistry.filter((el) => isLayoutableShape(el));
    return shapes.length === 0 ? [] : clusterIntoLayers(shapes);
  }

  const shapes = elementRegistry.filter(
    (el) => isLayoutableShape(el) && el.parent === parentFilter
  );

  return shapes.length === 0 ? [] : clusterIntoLayers(shapes);
}

/** Cluster shapes into layers by x-centre proximity. */
function clusterIntoLayers(shapes: BpmnElement[]): GridLayer[] {
  // Sort by x-centre
  const sorted = [...shapes].sort((a, b) => a.x + (a.width || 0) / 2 - (b.x + (b.width || 0) / 2));

  // Cluster into layers: elements within layerThreshold of the first
  // element in the current cluster are in the same layer.
  const layerThreshold = ELK_LAYER_SPACING / 2;
  const layers: GridLayer[] = [];
  let currentGroup: BpmnElement[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevCx = currentGroup[0].x + (currentGroup[0].width || 0) / 2;
    const currCx = sorted[i].x + (sorted[i].width || 0) / 2;
    if (Math.abs(currCx - prevCx) <= layerThreshold) {
      currentGroup.push(sorted[i]);
    } else {
      layers.push(buildLayer(currentGroup));
      currentGroup = [sorted[i]];
    }
  }
  layers.push(buildLayer(currentGroup));

  return layers;
}

function buildLayer(elements: BpmnElement[]): GridLayer {
  let minX = Infinity;
  let maxRight = -Infinity;
  let maxWidth = 0;
  for (const el of elements) {
    const x = el.x;
    const right = x + (el.width || 0);
    const w = el.width || 0;
    if (x < minX) minX = x;
    if (right > maxRight) maxRight = right;
    if (w > maxWidth) maxWidth = w;
  }
  return { elements, minX, maxRight, maxWidth };
}

/**
 * Classify the dominant element category of a layer.
 *
 * Returns 'event', 'gateway', or 'task' (the default catch-all that
 * includes service tasks, user tasks, subprocesses, etc.).
 */
function dominantCategory(layer: GridLayer): 'event' | 'gateway' | 'task' {
  let events = 0;
  let gateways = 0;
  for (const el of layer.elements) {
    if (el.type?.includes('Event')) events++;
    else if (el.type?.includes('Gateway')) gateways++;
  }
  const total = layer.elements.length;
  if (events > 0 && events >= total / 2) return 'event';
  if (gateways > 0 && gateways >= total / 2) return 'gateway';
  return 'task';
}

/**
 * Compute the horizontal gap between two adjacent layers based on their
 * dominant element types.
 *
 * Uses ELK_LAYER_SPACING as the baseline and applies small adjustments
 * for element type pairs to produce more natural-looking spacing:
 *
 * - **Event → Task / Task → Event**: slightly larger gap because events
 *   are small (36px wide) and need visual breathing room next to larger
 *   task shapes.
 * - **Gateway → Task / Task → Gateway**: standard gap — gateways (50px)
 *   are mid-sized and pair naturally with tasks at the default spacing.
 * - **Gateway → Event / Event → Gateway**: slightly tighter gap — both
 *   are compact shapes that look balanced with less whitespace.
 * - **Task → Task**: standard baseline gap.
 *
 * When the user provides a `layerSpacing` override via the layout tool,
 * that value replaces ELK_LAYER_SPACING everywhere, so the type-aware
 * deltas still apply relative to the override.
 */
function computeInterLayerGap(
  prevLayer: GridLayer,
  nextLayer: GridLayer,
  baseSpacing?: number
): number {
  const base = baseSpacing ?? ELK_LAYER_SPACING;
  const prevCat = dominantCategory(prevLayer);
  const nextCat = dominantCategory(nextLayer);

  // Event ↔ Task: add breathing room (events are small beside large tasks)
  if ((prevCat === 'event' && nextCat === 'task') || (prevCat === 'task' && nextCat === 'event')) {
    return base + EVENT_TASK_GAP_EXTRA;
  }

  // Gateway ↔ Event: tighten (both compact shapes)
  if (
    (prevCat === 'gateway' && nextCat === 'event') ||
    (prevCat === 'event' && nextCat === 'gateway')
  ) {
    return base - GATEWAY_EVENT_GAP_REDUCE;
  }

  // All other pairs (task→task, task↔gateway, event→event): baseline
  return base;
}

/**
 * Post-ELK grid snap pass.
 *
 * Steps:
 * 1. Detect discrete layers (columns) from element x-positions.
 * 2. Snap layers to type-aware x-columns with element-aware gaps.
 * 3. Distribute elements uniformly within each layer (vertical).
 * 4. Centre gateways on their connected branches.
 * 5. Preserve happy-path row (pin happy-path elements, distribute others).
 */
export function gridSnapPass(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  happyPathEdgeIds?: Set<string>,
  container?: BpmnElement,
  baseLayerSpacing?: number
): void {
  const layers = detectLayers(elementRegistry, container);
  if (layers.length < 2) return;

  // Determine happy-path element IDs from the happy-path edges
  const happyPathNodeIds = new Set<string>();
  if (happyPathEdgeIds && happyPathEdgeIds.size > 0) {
    const allElements: BpmnElement[] = elementRegistry.getAll();
    for (const el of allElements) {
      if (isConnection(el.type) && happyPathEdgeIds.has(el.id)) {
        if (el.source) happyPathNodeIds.add(el.source.id);
        if (el.target) happyPathNodeIds.add(el.target.id);
      }
    }
  }

  // ── Step 1: Snap layers to uniform x-columns ──
  // Compute column x-positions: each layer starts at
  // previous_layer_right_edge + type-aware gap.
  let columnX = layers[0].minX; // First layer stays at its current position

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];

    if (i > 0) {
      // Element-type-aware gap between adjacent layers
      const gap = computeInterLayerGap(layers[i - 1], layer, baseLayerSpacing);
      columnX = layers[i - 1].maxRight + gap;
    }

    // Centre each element in the column based on the max width
    for (const el of layer.elements) {
      const elW = el.width || 0;
      const desiredX = columnX + (layer.maxWidth - elW) / 2;
      const dx = Math.round(desiredX) - el.x;
      if (Math.abs(dx) > 0.5) {
        modeling.moveElements([el], { x: dx, y: 0 });
      }
    }

    // Update layer bounds after moving
    let newMinX = Infinity;
    let newMaxRight = -Infinity;
    for (const el of layer.elements) {
      const updated = elementRegistry.get(el.id)!;
      if (updated.x < newMinX) newMinX = updated.x;
      const right = updated.x + (updated.width || 0);
      if (right > newMaxRight) newMaxRight = right;
    }
    layers[i] = { ...layer, minX: newMinX, maxRight: newMaxRight };
  }

  // ── Step 2: Uniform vertical spacing within layers ──
  const nodeSpacing = ELK_NODE_SPACING;

  for (const layer of layers) {
    if (layer.elements.length < 2) continue;

    // Sort by current Y
    const sorted = [...layer.elements].sort((a, b) => a.y - b.y);

    // Identify happy-path elements in this layer
    const happyEls = sorted.filter((el) => happyPathNodeIds.has(el.id));
    const nonHappyEls = sorted.filter((el) => !happyPathNodeIds.has(el.id));

    // If there's a happy-path element, pin it and distribute others around it
    if (happyEls.length > 0 && nonHappyEls.length > 0) {
      // Pin the first happy-path element's Y as the reference
      const pinnedY = happyEls[0].y + (happyEls[0].height || 0) / 2;

      // Sort non-happy elements into above and below the pinned element
      const above = nonHappyEls.filter((el) => el.y + (el.height || 0) / 2 < pinnedY);
      const below = nonHappyEls.filter((el) => el.y + (el.height || 0) / 2 >= pinnedY);

      // Distribute above elements upward from the pinned position
      let nextY = pinnedY - (happyEls[0].height || 0) / 2 - nodeSpacing;
      for (let i = above.length - 1; i >= 0; i--) {
        const el = above[i];
        const elH = el.height || 0;
        const desiredY = nextY - elH;
        const dy = Math.round(desiredY) - el.y;
        if (Math.abs(dy) > 0.5) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
        nextY = desiredY - nodeSpacing;
      }

      // Distribute below elements downward from the pinned position
      nextY = pinnedY + (happyEls[0].height || 0) / 2 + nodeSpacing;
      for (const el of below) {
        const desiredY = nextY;
        const dy = Math.round(desiredY) - el.y;
        if (Math.abs(dy) > 0.5) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
        nextY = desiredY + (el.height || 0) + nodeSpacing;
      }
    } else {
      // No happy path — just distribute uniformly
      // Compute the vertical centre of the group
      const totalHeight = sorted.reduce((sum, el) => sum + (el.height || 0), 0);
      const totalGaps = (sorted.length - 1) * nodeSpacing;
      const groupHeight = totalHeight + totalGaps;
      const currentCentreY =
        (sorted[0].y + sorted[sorted.length - 1].y + (sorted[sorted.length - 1].height || 0)) / 2;
      let startY = currentCentreY - groupHeight / 2;

      for (const el of sorted) {
        const dy = Math.round(startY) - el.y;
        if (Math.abs(dy) > 0.5) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
        startY += (el.height || 0) + nodeSpacing;
      }
    }
  }

  // ── Step 3: Centre gateways on their connected branches ──
  // Skip gateways that are on the happy path to preserve straightness.
  centreGatewaysOnBranches(elementRegistry, modeling, happyPathNodeIds);

  // ── Step 4: Symmetrise gateway branches ──
  // For split gateways on the happy path, ensure off-path branches
  // are placed symmetrically above/below the happy-path centre line.
  symmetriseGatewayBranches(elementRegistry, modeling, happyPathNodeIds);

  // ── Step 5: Align boundary sub-flow end events ──
  // End events reachable from boundary event flows should align with
  // their immediate predecessor's Y to form clean visual rows.
  alignBoundarySubFlowEndEvents(elementRegistry, modeling);
}
