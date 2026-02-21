/**
 * Post-ELK grid snap pass — core functions.
 *
 * Quantises node coordinates to a virtual grid after ELK positioning,
 * combining ELK's optimal topology with bpmn-auto-layout's visual
 * regularity.
 */

import {
  ELK_LAYER_SPACING,
  ELK_NODE_SPACING,
  ELK_BRANCH_NODE_SPACING,
  ELK_BOUNDARY_NODE_SPACING,
} from '../constants';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { isConnection, isLayoutableShape } from './helpers';
import {
  EVENT_TASK_GAP_EXTRA,
  INTERMEDIATE_EVENT_TASK_GAP_REDUCE,
  GATEWAY_TASK_GAP_EXTRA,
  GATEWAY_EVENT_GAP_REDUCE,
  GATEWAY_GATEWAY_GAP_EXTRA,
  BOUNDARY_HOST_GAP_EXTRA,
  MOVEMENT_THRESHOLD,
} from './constants';
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

  // Build a connection lookup: element ID → set of directly connected element IDs.
  // Used by clusterIntoLayers to prevent merging connected elements into the
  // same layer — a start event directly connected to a task must be in a
  // separate column even when ELK places them within the merge threshold.
  const connectedIds = new Map<string, Set<string>>();
  const allConnections = elementRegistry
    .getAll()
    .filter((el: BpmnElement) => isConnection(el.type));
  for (const conn of allConnections) {
    if (!conn.source?.id || !conn.target?.id) continue;
    if (!connectedIds.has(conn.source.id)) connectedIds.set(conn.source.id, new Set());
    if (!connectedIds.has(conn.target.id)) connectedIds.set(conn.target.id, new Set());
    connectedIds.get(conn.source.id)!.add(conn.target.id);
    connectedIds.get(conn.target.id)!.add(conn.source.id);
  }

  // If no root found (shouldn't happen), fall back to including all elements
  if (!parentFilter) {
    const shapes = elementRegistry.filter((el) => isLayoutableShape(el));
    return shapes.length === 0 ? [] : clusterIntoLayers(shapes, connectedIds);
  }

  const shapes = elementRegistry.filter(
    (el) => isLayoutableShape(el) && el.parent === parentFilter
  );

  return shapes.length === 0 ? [] : clusterIntoLayers(shapes, connectedIds);
}

/** Cluster shapes into layers by x-centre proximity. */
function clusterIntoLayers(
  shapes: BpmnElement[],
  connectedIds?: Map<string, Set<string>>
): GridLayer[] {
  // Sort by x-centre
  const sorted = [...shapes].sort((a, b) => a.x + (a.width || 0) / 2 - (b.x + (b.width || 0) / 2));

  // Cluster into layers: elements within layerThreshold of the first
  // element in the current cluster are in the same layer, UNLESS the
  // candidate is directly connected (via a sequence flow) to any element
  // already in the current group.  Connected elements belong in adjacent
  // layers even when ELK compresses them below the merge threshold.
  const layerThreshold = ELK_LAYER_SPACING / 2;
  const layers: GridLayer[] = [];
  let currentGroup: BpmnElement[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevCx = currentGroup[0].x + (currentGroup[0].width || 0) / 2;
    const currCx = sorted[i].x + (sorted[i].width || 0) / 2;

    // Force a layer split when the candidate is directly connected to any
    // element in the current group AND there is a meaningful X separation
    // between them.  The X-separation guard (> 5px) prevents false splits in
    // vertical (DOWN/UP) layouts where all elements share the same X-column
    // and would otherwise be incorrectly dispersed into separate columns.
    const xDiff = Math.abs(currCx - prevCx);
    const isConnectedToGroup =
      xDiff > 5 &&
      connectedIds !== undefined &&
      currentGroup.some((groupEl) => connectedIds.get(groupEl.id)?.has(sorted[i].id));

    if (!isConnectedToGroup && xDiff <= layerThreshold) {
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
 * Returns 'intermediateEvent' for layers dominated by mid-flow catch/throw
 * events (G1), 'event' for start/end event layers, 'gateway' for gateway
 * layers, or 'task' (the default catch-all for tasks, subprocesses, etc.).
 *
 * Intermediate events are distinguished from start/end events because they
 * appear inline with the main sequence flow and use slightly tighter
 * horizontal spacing in Camunda Modeler reference layouts.
 */
function dominantCategory(layer: GridLayer): 'intermediateEvent' | 'event' | 'gateway' | 'task' {
  let intermediateEvents = 0;
  let startEndEvents = 0;
  let gateways = 0;
  for (const el of layer.elements) {
    if (el.type === 'bpmn:IntermediateCatchEvent' || el.type === 'bpmn:IntermediateThrowEvent') {
      intermediateEvents++;
    } else if (el.type?.includes('Event')) {
      startEndEvents++;
    } else if (el.type?.includes('Gateway')) {
      gateways++;
    }
  }
  const total = layer.elements.length;
  if (intermediateEvents > 0 && intermediateEvents >= total / 2) return 'intermediateEvent';
  if (startEndEvents > 0 && startEndEvents >= total / 2) return 'event';
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
 * - **IntermediateEvent → Task / Task → IntermediateEvent**: slightly tighter
 *   gap (G1) — intermediate catch/throw events appear inline with the main
 *   flow and use compact spacing in Camunda Modeler reference layouts.
 * - **Event → Task / Task → Event**: baseline gap — start/end events are
 *   bookend shapes that use the same spacing as task-to-task transitions.
 * - **Gateway → Task / Task → Gateway**: slightly larger gap — gateways
 *   (50px) are narrower than tasks (100px) and need a small gap boost
 *   to produce balanced visual spacing.
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

  // IntermediateEvent ↔ Task: tighter spacing (G1)
  // Intermediate events are inline compact shapes that Camunda Modeler
  // places with slightly tighter horizontal spacing than start/end events.
  if (
    (prevCat === 'intermediateEvent' && nextCat === 'task') ||
    (prevCat === 'task' && nextCat === 'intermediateEvent')
  ) {
    return base - INTERMEDIATE_EVENT_TASK_GAP_REDUCE;
  }

  // IntermediateEvent ↔ Gateway: treat like event↔gateway (both compact)
  if (
    (prevCat === 'intermediateEvent' && nextCat === 'gateway') ||
    (prevCat === 'gateway' && nextCat === 'intermediateEvent')
  ) {
    return base - GATEWAY_EVENT_GAP_REDUCE;
  }

  // Event ↔ Task: add breathing room (events are small beside large tasks)
  if ((prevCat === 'event' && nextCat === 'task') || (prevCat === 'task' && nextCat === 'event')) {
    return base + EVENT_TASK_GAP_EXTRA;
  }

  // Gateway ↔ Task: add breathing room (gateways are narrower than tasks)
  if (
    (prevCat === 'gateway' && nextCat === 'task') ||
    (prevCat === 'task' && nextCat === 'gateway')
  ) {
    return base + GATEWAY_TASK_GAP_EXTRA;
  }

  // Gateway ↔ Gateway: add extra room (both compact shapes need more spacing)
  if (prevCat === 'gateway' && nextCat === 'gateway') {
    return base + GATEWAY_GATEWAY_GAP_EXTRA;
  }

  // Gateway ↔ Event: tighten (both compact shapes)
  if (
    (prevCat === 'gateway' && nextCat === 'event') ||
    (prevCat === 'event' && nextCat === 'gateway')
  ) {
    return base - GATEWAY_EVENT_GAP_REDUCE;
  }

  // All other pairs (task→task, event→event, intermediateEvent→event, etc.): baseline
  return base;
}

/**
 * Detect whether all elements in a layer are branches of the same
 * gateway (fork or join pattern).
 *
 * Returns true when every element either:
 * - shares a common source gateway (fork pattern: GW → A, GW → B, GW → C), or
 * - shares a common target gateway (join pattern: A → GW, B → GW, C → GW).
 *
 * When true, the layer should use tighter vertical spacing
 * (ELK_BRANCH_NODE_SPACING) because parallel branches look best with
 * compact gaps matching the bpmn-auto-layout / Camunda Modeler reference.
 */
function isGatewayBranchLayer(elements: BpmnElement[], allConnections: BpmnElement[]): boolean {
  if (elements.length < 2) return false;

  // Build sets of source and target gateway IDs for each element
  const commonSourceGateways = new Map<string, number>();
  const commonTargetGateways = new Map<string, number>();

  for (const el of elements) {
    const sourceGwIds = new Set<string>();
    const targetGwIds = new Set<string>();

    for (const conn of allConnections) {
      // Incoming connection from a gateway → this element is a fork branch
      if (conn.target?.id === el.id && conn.source?.type?.includes('Gateway')) {
        sourceGwIds.add(conn.source.id);
      }
      // Outgoing connection to a gateway → this element is a join branch
      if (conn.source?.id === el.id && conn.target?.type?.includes('Gateway')) {
        targetGwIds.add(conn.target.id);
      }
    }

    for (const gwId of sourceGwIds) {
      commonSourceGateways.set(gwId, (commonSourceGateways.get(gwId) || 0) + 1);
    }
    for (const gwId of targetGwIds) {
      commonTargetGateways.set(gwId, (commonTargetGateways.get(gwId) || 0) + 1);
    }
  }

  const n = elements.length;

  // All elements share the same source gateway (fork)
  for (const count of commonSourceGateways.values()) {
    if (count === n) return true;
  }

  // All elements share the same target gateway (join)
  for (const count of commonTargetGateways.values()) {
    if (count === n) return true;
  }

  return false;
}

/**
 * Detect whether a layer contains a boundary sub-flow target alongside
 * a happy-path element.
 *
 * When a task receives incoming flow from a boundary event, the vertical
 * spacing between it and the happy-path element in the same layer should
 * be tighter (ELK_BRANCH_NODE_SPACING) to match the reference layouts
 * where boundary exception paths are placed compactly below the main flow.
 */
function hasBoundarySubFlowTarget(elements: BpmnElement[], allConnections: BpmnElement[]): boolean {
  if (elements.length < 2) return false;

  for (const el of elements) {
    for (const conn of allConnections) {
      if (conn.target?.id !== el.id) continue;
      // Check if incoming flow source is a boundary event
      if (conn.source?.type === 'bpmn:BoundaryEvent') return true;
      // Also check if the incoming source itself receives from a boundary event
      // (indirect boundary target, e.g. BE → intermediate → this task)
    }
  }

  return false;
}

/**
 * Detect whether a layer contains a task/subprocess that has attached
 * boundary events.
 *
 * When a task hosts boundary events, the post-ELK layout needs extra
 * horizontal space after it — the boundary event target sub-flow is
 * placed below, and reference layouts consistently use wider gaps
 * (80–87px vs 60–65px) after such host tasks.
 */
function hasBoundaryEventHost(elements: BpmnElement[], elementRegistry: ElementRegistry): boolean {
  // Check all boundary events in the registry for hosts in this layer
  const layerIds = new Set(elements.map((el) => el.id));
  const allElements: BpmnElement[] = elementRegistry.getAll();
  for (const el of allElements) {
    if (el.type === 'bpmn:BoundaryEvent' && el.host && layerIds.has(el.host.id)) {
      return true;
    }
  }
  return false;
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
      let gap = computeInterLayerGap(layers[i - 1], layer, baseLayerSpacing);

      // Add extra spacing after layers containing boundary-event hosts.
      // Tasks with attached boundary events need room for the boundary
      // target sub-flow placed below; reference layouts use ~20px more.
      if (hasBoundaryEventHost(layers[i - 1].elements, elementRegistry)) {
        gap += BOUNDARY_HOST_GAP_EXTRA;
      }

      columnX = layers[i - 1].maxRight + gap;
    }

    // Centre each element in the column based on the max width
    for (const el of layer.elements) {
      const elW = el.width || 0;
      const desiredX = columnX + (layer.maxWidth - elW) / 2;
      const dx = Math.round(desiredX) - el.x;
      if (Math.abs(dx) > MOVEMENT_THRESHOLD) {
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
  const defaultNodeSpacing = ELK_NODE_SPACING;

  // Pre-compute all connections once for gateway branch detection
  const allConnections = elementRegistry
    .getAll()
    .filter((el: BpmnElement) => isConnection(el.type));

  for (const layer of layers) {
    if (layer.elements.length < 2) continue;

    // Use tighter spacing for gateway branches (parallel fork-join pattern)
    // or boundary sub-flow targets (exception path below main flow).
    let nodeSpacing = defaultNodeSpacing;
    if (isGatewayBranchLayer(layer.elements, allConnections)) {
      nodeSpacing = ELK_BRANCH_NODE_SPACING;
    } else if (hasBoundarySubFlowTarget(layer.elements, allConnections)) {
      nodeSpacing = ELK_BOUNDARY_NODE_SPACING;
    }

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
        if (Math.abs(dy) > MOVEMENT_THRESHOLD) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
        nextY = desiredY - nodeSpacing;
      }

      // Distribute below elements downward from the pinned position
      nextY = pinnedY + (happyEls[0].height || 0) / 2 + nodeSpacing;
      for (const el of below) {
        const desiredY = nextY;
        const dy = Math.round(desiredY) - el.y;
        if (Math.abs(dy) > MOVEMENT_THRESHOLD) {
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
        if (Math.abs(dy) > MOVEMENT_THRESHOLD) {
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
// ── Pixel-grid snap utilities (D3) ─────────────────────────────────────────

/**
 * Snap all layoutable shape positions to a pixel grid (D3-1).
 *
 * Applied as a final pass after all other layout steps to ensure
 * visual regularity and alignment with bpmn-js's interactive editing
 * grid quantum (default: 10px).
 *
 * Boundary events are excluded — they must stay on their host shape's
 * boundary, which may not align to the grid.
 *
 * @param quantum Grid quantum in pixels (e.g. 10 for bpmn-js's grid).
 */
export function snapShapesToPixelGrid(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  quantum: number
): void {
  const shapes = elementRegistry.filter(
    (el) => isLayoutableShape(el) && el.type !== 'bpmn:BoundaryEvent'
  );
  for (const el of shapes) {
    const snappedX = Math.round(el.x / quantum) * quantum;
    const snappedY = Math.round(el.y / quantum) * quantum;
    if (snappedX !== el.x || snappedY !== el.y) {
      modeling.moveElements([el], { x: snappedX - el.x, y: snappedY - el.y });
    }
  }
}

/**
 * Snap connection waypoint coordinates to a pixel grid (D3-2).
 *
 * Intermediate waypoints are rounded to the nearest grid quantum.
 * Endpoint waypoints (first and last) are excluded to keep them on
 * shape boundaries, which may not align to the grid.
 *
 * @param quantum Grid quantum in pixels (e.g. 10).
 */
export function snapWaypointsToPixelGrid(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  quantum: number
): void {
  const connections = elementRegistry.filter(
    (el) => isConnection(el.type) && !!el.waypoints && el.waypoints.length >= 2
  );
  for (const conn of connections) {
    const wps = conn.waypoints!;
    const snapped = wps.map((wp, i) => {
      // Preserve endpoints — they must stay on shape boundaries
      if (i === 0 || i === wps.length - 1) return { x: wp.x, y: wp.y };
      return {
        x: Math.round(wp.x / quantum) * quantum,
        y: Math.round(wp.y / quantum) * quantum,
      };
    });
    const changed = snapped.some((wp, i) => wp.x !== wps[i].x || wp.y !== wps[i].y);
    if (changed) {
      modeling.updateWaypoints(conn, snapped);
    }
  }
}
