/**
 * Lane layout utilities for the rebuild-based layout engine.
 *
 * After elements are positioned by the main rebuild engine
 * (correct X ordering, default Y), lane-aware adjustments
 * move elements vertically into their assigned lane bands and
 * resize lanes/pool to fit the content.
 */

import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { resetStaleWaypoints } from './waypoints';

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Default height (px) for each lane in a pool.
 * Matches typical BPMN lane sizing in Camunda Modeler.
 * Exported so the rebuild engine can use it for lane-aware Y pre-positioning.
 */
export const DEFAULT_LANE_HEIGHT = 250;

/**
 * Minimum lane height (px) even for empty / sparse lanes.
 */
const MIN_LANE_HEIGHT = 120;

/**
 * Width (px) of the pool's left header strip.
 * Lanes start after this strip.
 */
const POOL_HEADER_WIDTH = 30;

/** BPMN type string for sequence flows (used in multiple filters). */
const SEQUENCE_FLOW_TYPE = 'bpmn:SequenceFlow';

/** Spacing between co-column sibling elements within a lane. */
const BRANCH_SPREAD_SPACING = 130;

/** Element types skipped when computing lane flow-node positions. */
const LANE_SKIP_TYPES = new Set([
  SEQUENCE_FLOW_TYPE,
  'bpmn:Lane',
  'bpmn:LaneSet',
  'label',
  'bpmn:BoundaryEvent',
]);

// ── Lane detection ─────────────────────────────────────────────────────────

/**
 * Get all lane elements within a participant pool.
 */
export function getLanesForParticipant(
  registry: ElementRegistry,
  participant: BpmnElement
): BpmnElement[] {
  const allElements: BpmnElement[] = registry.getAll();
  return allElements.filter((el) => el.type === 'bpmn:Lane' && isDescendantOf(el, participant));
}

/** Check if an element is a descendant of an ancestor element. */
function isDescendantOf(el: BpmnElement, ancestor: BpmnElement): boolean {
  let current = el.parent;
  while (current) {
    if (current.id === ancestor.id) return true;
    current = current.parent;
  }
  return false;
}

// ── Lane assignment mapping ────────────────────────────────────────────────

/**
 * Build a mapping of element ID → lane for elements within a pool.
 *
 * Strategy (issue #13):
 * 1. First, check `element.parent` — when an element was explicitly added
 *    to a lane via `add_bpmn_element laneId`, its diagram-js parent is the
 *    lane shape.  This is the authoritative source before the first layout.
 * 2. Fall back to `lane.businessObject.flowNodeRef` for elements whose
 *    parent is not a lane (e.g. boundary events, which sit on their host's
 *    parent).  bpmn-js updates flowNodeRef based on y-coordinate ownership,
 *    which can disagree with the explicit `add` call before layout runs.
 *
 * The `lanes` array is used to build a fast lookup set so the parent-walk
 * can identify lane shapes in O(1).
 */
export function buildElementToLaneMap(
  lanes: BpmnElement[],
  registry?: ElementRegistry
): Map<string, BpmnElement> {
  const elementToLane = new Map<string, BpmnElement>();
  // Pass 1: prefer element.parent when it's a lane shape.
  if (registry) {
    const laneById = new Map(lanes.map((l) => [l.id, l]));
    for (const el of registry.getAll() as BpmnElement[]) {
      const lane = el.parent && laneById.get(el.parent.id);
      if (lane) elementToLane.set(el.id, lane);
    }
  }
  // Pass 2: fall back to flowNodeRef for anything not already mapped.
  for (const lane of lanes) {
    for (const ref of lane.businessObject?.flowNodeRef ?? []) {
      if (ref?.id && !elementToLane.has(ref.id)) elementToLane.set(ref.id, lane);
    }
  }
  return elementToLane;
}

/**
 * Build a map from element ID to actual lane center Y.
 *
 * Uses actual lane.y + lane.height/2 so elements are placed within
 * existing lane bounds before resizing (prevents out-of-pool positioning
 * when pools use non-default lane heights).
 */
export function buildElementLaneYMap(
  lanes: BpmnElement[],
  savedLaneMap: Map<string, BpmnElement>
): Map<string, number> {
  if (lanes.length === 0 || savedLaneMap.size === 0) return new Map();
  const cyMap = new Map(
    [...lanes]
      .sort((a, b) => a.y - b.y)
      .map((l) => [l.id, l.y + (l.height || DEFAULT_LANE_HEIGHT) / 2])
  );
  const result = new Map<string, number>();
  for (const [elId, lane] of savedLaneMap) {
    const cy = cyMap.get(lane.id);
    if (cy !== undefined) result.set(elId, cy);
  }
  return result;
}

// ── Lane layout application ────────────────────────────────────────────────

/** Spread co-column elements symmetrically around their lane's center Y. */
function spreadCoColumnElements(
  laneColumns: Map<string, BpmnElement[]>,
  laneCenterYs: Map<string, number>,
  branchSpacing: number,
  modeling: Modeling
): number {
  let count = 0;
  for (const [key, siblings] of laneColumns) {
    if (siblings.length < 2) {
      // Single element — move to lane centre as before.
      const laneId = key.split(':')[0];
      const targetY = laneCenterYs.get(laneId)!;
      const el = siblings[0];
      const dy = Math.round(targetY - (el.y + el.height / 2));
      if (dy !== 0) {
        modeling.moveElements([el], { x: 0, y: dy });
        count++;
      }
      continue;
    }

    // Issue #12: if elements were already spread by resolvePositionOverlaps
    // (i.e. every consecutive pair differs by ≥ branchSpacing), skip
    // re-spreading to avoid collapsing the spread back to lane-centre Y.
    siblings.sort((a, b) => a.y - b.y);
    let alreadySpread = true;
    for (let i = 1; i < siblings.length; i++) {
      const prevCY = siblings[i - 1].y + siblings[i - 1].height / 2;
      const currCY = siblings[i].y + siblings[i].height / 2;
      if (Math.abs(currCY - prevCY) < branchSpacing - 1) {
        alreadySpread = false;
        break;
      }
    }
    if (alreadySpread) continue;

    // Not yet spread — apply symmetric distribution around lane centre.
    const laneId = key.split(':')[0];
    const targetY = laneCenterYs.get(laneId)!;
    for (let i = 0; i < siblings.length; i++) {
      const el = siblings[i];
      const offset = (i - (siblings.length - 1) / 2) * branchSpacing;
      const dy = Math.round(targetY + offset - (el.y + el.height / 2));
      if (dy !== 0) {
        modeling.moveElements([el], { x: 0, y: dy });
        count++;
      }
    }
  }
  return count;
}

/**
 * Apply lane-aware Y positioning and resize lanes/pool.
 *
 * Moves each flow node to its assigned lane's center Y, resizes
 * lanes/pool to fit, then re-routes all connections.
 *
 * @param skipResize  When true, skip pool/lane resize (caller runs autosize).
 * @returns Number of elements repositioned.
 */
export function applyLaneLayout(
  registry: ElementRegistry,
  modeling: Modeling,
  participant: BpmnElement,
  padding: number,
  savedLaneMap: Map<string, BpmnElement>,
  skipResize?: boolean
): number {
  const lanes = getLanesForParticipant(registry, participant);
  if (lanes.length === 0) return 0;

  const sortedLanes = [...lanes].sort((a, b) => a.y - b.y);
  const laneCenterYs = new Map(sortedLanes.map((l) => [l.id, l.y + l.height / 2]));

  const allElements: BpmnElement[] = registry.getAll();
  // Boundary events follow their host; skip them to avoid breaking attachment.
  const flowNodes = allElements.filter(
    (el) => savedLaneMap.has(el.id) && !LANE_SKIP_TYPES.has(el.type)
  );

  const laneColumns = new Map<string, BpmnElement[]>();
  for (const el of flowNodes) {
    const lane = savedLaneMap.get(el.id);
    if (!lane || laneCenterYs.get(lane.id) === undefined) continue;
    const key = `${lane.id}:${Math.round(el.x + el.width / 2)}`;
    if (!laneColumns.has(key)) laneColumns.set(key, []);
    laneColumns.get(key)!.push(el);
  }

  let repositioned = spreadCoColumnElements(
    laneColumns,
    laneCenterYs,
    BRANCH_SPREAD_SPACING,
    modeling
  );

  if (!skipResize) {
    resizePoolAndLanes(sortedLanes, participant, registry, modeling, padding, savedLaneMap);
  }

  repositioned += clampColumnGroupsToLaneBounds(laneColumns, sortedLanes, registry, modeling);
  restoreLaneAssignments(registry, savedLaneMap, sortedLanes);
  reroutePoolConnections(allElements, participant, savedLaneMap, modeling);

  return repositioned;
}

/**
 * Post-resize clamp: re-centre any column group that drifted outside
 * its lane bounds after `resizePoolAndLanes` shifted lane positions.
 */
function clampColumnGroupsToLaneBounds(
  laneColumns: Map<string, BpmnElement[]>,
  sortedLanes: BpmnElement[],
  registry: ElementRegistry,
  modeling: Modeling
): number {
  let count = 0;
  for (const [key, siblings] of laneColumns) {
    const lane = sortedLanes.find((l) => l.id === key.split(':')[0]);
    if (!lane) continue;
    const els = siblings.map((el) => registry.get(el.id) ?? el);
    const groupTop = Math.min(...els.map((el) => el.y));
    const groupBottom = Math.max(...els.map((el) => el.y + (el.height || 0)));
    if (groupTop >= lane.y - 5 && groupBottom <= lane.y + lane.height + 5) continue;
    const shift = Math.round(lane.y + lane.height / 2 - (groupTop + groupBottom) / 2);
    if (Math.abs(shift) < 1) continue;
    for (const el of els) {
      modeling.moveElements([el], { x: 0, y: shift });
      count++;
    }
  }
  return count;
}

/**
 * Re-layout pool connections after element repositioning, then apply
 * improved cross-lane routing.
 */
function reroutePoolConnections(
  allElements: BpmnElement[],
  participant: BpmnElement,
  savedLaneMap: Map<string, BpmnElement>,
  modeling: Modeling
): void {
  for (const el of allElements) {
    if (el.parent === participant && el.type === SEQUENCE_FLOW_TYPE) {
      try {
        resetStaleWaypoints(el);
        modeling.layoutConnection(el);
      } catch {
        // skip connections with inconsistent waypoints
      }
    }
  }
  routeCrossLaneConnections(allElements, participant, savedLaneMap, modeling);
}

// ── Cross-lane connection routing (tasks 3b, 9b) ───────────────────────────

/**
 * Improve waypoint routing for cross-lane sequence flows.
 *
 * After `modeling.layoutConnection()` runs, flows between different lanes
 * can produce multi-bend paths that route through unrelated lane content.
 * This function replaces those with cleaner L-shaped paths:
 *
 *   source right-edge → vertical midpoint → target left-edge
 *
 * The routing prefers a single vertical segment at the X midpoint
 * between source and target, which cleanly traverses the lane boundary
 * without crossing other lanes' elements.
 *
 * Only applies to forward flows (where target.x > source.x and the
 * source and target are in different lanes).  Back-edges and same-lane
 * flows are left as-is.
 */
function routeCrossLaneConnections(
  allElements: BpmnElement[],
  participant: BpmnElement,
  savedLaneMap: Map<string, BpmnElement>,
  modeling: Modeling
): void {
  const sequenceFlows = allElements.filter(
    (el) => el.parent === participant && el.type === SEQUENCE_FLOW_TYPE && el.source && el.target
  );

  for (const flow of sequenceFlows) {
    const src = flow.source as BpmnElement;
    const tgt = flow.target as BpmnElement;

    // Only process forward flows (target is to the right of source)
    if (tgt.x + (tgt.width || 0) / 2 <= src.x + (src.width || 0) / 2) continue;

    // Only process cross-lane flows
    const srcLane = savedLaneMap.get(src.id);
    const tgtLane = savedLaneMap.get(tgt.id);
    if (!srcLane || !tgtLane || srcLane.id === tgtLane.id) continue;

    if (!flow.waypoints?.length) continue;

    // Clean L-shaped routing: 3 waypoints (1 bend) for adjacent lanes,
    // 4 waypoints (2 bends, midX column) for multi-lane vertical drops.
    const sy = Math.round(src.y + (src.height || 0) / 2);
    const ty = Math.round(tgt.y + (tgt.height || 0) / 2);
    const rx = src.x + (src.width || 0);
    const lx = tgt.x;
    const midX = Math.round((rx + lx) / 2);
    const wp = (x: number, y: number) => ({ x, y });
    const cleanWaypoints =
      Math.abs(ty - sy) <= DEFAULT_LANE_HEIGHT
        ? [wp(rx, sy), wp(lx, sy), wp(lx, ty)]
        : [wp(rx, sy), wp(midX, sy), wp(midX, ty), wp(lx, ty)];

    try {
      modeling.updateWaypoints(flow, cleanWaypoints);
    } catch {
      // Non-fatal: fall back to layoutConnection's result
    }
  }
}

// ── Lane assignment restoration ────────────────────────────────────────────

/**
 * Restore `flowNodeRef` membership lists from a previously-captured
 * element-to-lane mapping.
 *
 * `modeling.moveElements` may silently update `flowNodeRef` lists when
 * elements are repositioned outside a lane's current visual bounds.
 * Calling this function after `rebuildContainer()` — but before
 * `applyLaneLayout()` — ensures the semantic lane assignments match the
 * intent captured before the rebuild.
 *
 * @param registry      Element registry for the modeler.
 * @param savedLaneMap  Map of elementId → intended lane element.
 * @param lanes         All lane elements in the participant.
 */
export function restoreLaneAssignments(
  registry: ElementRegistry,
  savedLaneMap: Map<string, BpmnElement>,
  lanes: BpmnElement[]
): void {
  if (savedLaneMap.size === 0 || lanes.length === 0) return;

  // Clear existing flowNodeRef lists for affected lanes, then re-populate.
  const affectedLaneIds = new Set([...savedLaneMap.values()].map((l) => l.id));
  for (const lane of lanes) {
    const refs = lane.businessObject?.flowNodeRef;
    if (affectedLaneIds.has(lane.id) && Array.isArray(refs)) refs.length = 0;
  }
  for (const [elementId, lane] of savedLaneMap) {
    const el = registry.get(elementId);
    const laneBo = lane.businessObject;
    if (!el || !laneBo) continue;
    if (!Array.isArray(laneBo.flowNodeRef)) laneBo.flowNodeRef = [];
    const elBo = el.businessObject;
    if (elBo && !laneBo.flowNodeRef.includes(elBo)) laneBo.flowNodeRef.push(elBo);
  }
}

// ── Boundary event lane sync ───────────────────────────────────────────────

/**
 * Sync boundary event lane membership to match their host element's lane.
 *
 * After `positionBoundaryEventsAndChains()` runs, bpmn-js may assign each
 * boundary event to whichever lane its y-coordinate falls inside, which
 * can differ from the host's lane (issue #14).  This function explicitly
 * sets each boundary event's `flowNodeRef` membership to match its host.
 *
 * @param registry     Element registry for the modeler.
 * @param savedLaneMap Element-ID → intended lane (captured before rebuild).
 * @param lanes        All lane elements in the participant.
 */
export function syncBoundaryEventLanes(
  registry: ElementRegistry,
  savedLaneMap: Map<string, BpmnElement>,
  lanes: BpmnElement[]
): void {
  if (savedLaneMap.size === 0 || lanes.length === 0) return;

  const boundaryEvents = (registry.getAll() as BpmnElement[]).filter(
    (el) => el.type === 'bpmn:BoundaryEvent' && el.host
  );
  for (const be of boundaryEvents) {
    const hostLane = savedLaneMap.get(be.host!.id);
    if (!hostLane) continue;
    const beId = be.businessObject?.id;
    for (const lane of lanes) {
      const refs = lane.businessObject?.flowNodeRef;
      if (!Array.isArray(refs)) continue;
      const idx = refs.findIndex((r: any) => r?.id === beId);
      if (idx !== -1) refs.splice(idx, 1);
    }
    const laneBo = hostLane.businessObject;
    if (!laneBo) continue;
    if (!Array.isArray(laneBo.flowNodeRef)) laneBo.flowNodeRef = [];
    const beBo = be.businessObject;
    if (beBo && !laneBo.flowNodeRef.includes(beBo)) laneBo.flowNodeRef.push(beBo);
  }
}

// ── Pool resizing (no lanes) ───────────────────────────────────────────────

/**
 * Resize a participant pool to fit its internal elements with padding.
 * For pools without lanes.
 */
export function resizePoolToFit(
  modeling: Modeling,
  registry: ElementRegistry,
  participant: BpmnElement,
  padding: number
): void {
  const bbox = computePoolContentBBox(registry, participant);
  if (!bbox) return;

  modeling.resizeShape(participant, {
    x: bbox.minX - padding - POOL_HEADER_WIDTH,
    y: bbox.minY - padding,
    width: bbox.maxX - bbox.minX + 2 * padding + POOL_HEADER_WIDTH,
    height: bbox.maxY - bbox.minY + 2 * padding,
  });
}

// ── Pool and lane resizing ─────────────────────────────────────────────────

/**
 * Resize lanes and their parent pool to fit element content.
 *
 * Lane heights are proportional to their content extent, clamped to
 * MIN_LANE_HEIGHT.  Lanes are stacked contiguously from the pool's top
 * edge.  The pool is resized to enclose all lanes.
 *
 * This function runs AFTER applyLaneLayout() has moved elements to their
 * lane center-Y positions.  Element Y coordinates are the ground truth for
 * computing required lane extents.
 */
function resizePoolAndLanes(
  sortedLanes: BpmnElement[],
  participant: BpmnElement,
  registry: ElementRegistry,
  modeling: Modeling,
  padding: number,
  elementToLane: Map<string, BpmnElement>
): void {
  const bbox = computePoolContentBBox(registry, participant);
  if (!bbox) return;

  // Overall pool horizontal bounds from content
  const poolX = bbox.minX - padding - POOL_HEADER_WIDTH;
  const poolWidth = bbox.maxX - bbox.minX + 2 * padding + POOL_HEADER_WIDTH;
  const poolY = bbox.minY - padding;

  // Compute proportional lane heights
  const allElements: BpmnElement[] = registry.getAll();
  const skipTypes = new Set([SEQUENCE_FLOW_TYPE, 'bpmn:Lane', 'bpmn:LaneSet', 'label']);
  const flowNodes = allElements.filter((el) => !skipTypes.has(el.type) && typeof el.y === 'number');

  // For each lane, compute required height from element Y extents.
  const rawHeights = sortedLanes.map((lane) => {
    const laneEls = flowNodes.filter((el) => elementToLane.get(el.id)?.id === lane.id);
    if (laneEls.length === 0) return MIN_LANE_HEIGHT;
    const span =
      Math.max(...laneEls.map((el) => el.y + el.height)) - Math.min(...laneEls.map((el) => el.y));
    return Math.max(MIN_LANE_HEIGHT, span + 2 * padding);
  });

  // Total pool height must fit all content: max of (sum of raw heights) and
  // (maxElement.bottom - minElement.top + 2*padding)
  const contentSpan = bbox.maxY - bbox.minY + 2 * padding;
  const rawTotal = rawHeights.reduce((s, h) => s + h, 0);
  const totalHeight = Math.max(rawTotal, contentSpan);

  // Scale up proportionally if needed
  const scale = totalHeight / rawTotal;
  const laneHeights = rawHeights.map((h) => Math.round(h * scale));
  // Adjust last lane to avoid rounding errors
  const heightSum = laneHeights.slice(0, -1).reduce((s, h) => s + h, 0);
  laneHeights[laneHeights.length - 1] = totalHeight - heightSum;

  modeling.resizeShape(participant, {
    x: poolX,
    y: poolY,
    width: poolWidth,
    height: totalHeight,
  });

  // Stack lanes contiguously from poolY
  const laneX = poolX + POOL_HEADER_WIDTH;
  const laneWidth = poolWidth - POOL_HEADER_WIDTH;
  let currentY = poolY;
  for (const [i, lane] of sortedLanes.entries()) {
    modeling.resizeShape(lane, { x: laneX, y: currentY, width: laneWidth, height: laneHeights[i] });
    currentY += laneHeights[i];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Compute the bounding box of flow elements inside a participant. */
function computePoolContentBBox(
  registry: ElementRegistry,
  participant: BpmnElement
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  // Include both direct children and lane-parented elements.
  const skipTypes = new Set([SEQUENCE_FLOW_TYPE, 'bpmn:Lane', 'bpmn:LaneSet', 'label']);
  const children = (registry.getAll() as BpmnElement[]).filter(
    (el) =>
      !skipTypes.has(el.type) &&
      el.parent &&
      (el.parent === participant ||
        (el.parent.type === 'bpmn:Lane' && el.parent.parent === participant))
  );
  if (children.length === 0) return null;
  return {
    minX: Math.min(...children.map((el) => el.x)),
    minY: Math.min(...children.map((el) => el.y)),
    maxX: Math.max(...children.map((el) => el.x + el.width)),
    maxY: Math.max(...children.map((el) => el.y + el.height)),
  };
}
