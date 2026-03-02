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
  const laneSet = new Set(lanes.map((l) => l.id));

  // Pass 1: prefer element.parent when it's a lane shape.
  if (registry) {
    const allElements: BpmnElement[] = registry.getAll();
    for (const el of allElements) {
      if (!el.parent || !laneSet.has(el.parent.id)) continue;
      // Find the lane BpmnElement (we need the full element, not just the id)
      const parentLane = lanes.find((l) => l.id === el.parent!.id);
      if (parentLane) elementToLane.set(el.id, parentLane);
    }
  }

  // Pass 2: fall back to flowNodeRef for anything not already mapped.
  for (const lane of lanes) {
    const refs = lane.businessObject?.flowNodeRef;
    if (!Array.isArray(refs)) continue;
    for (const ref of refs) {
      if (ref?.id && !elementToLane.has(ref.id)) {
        elementToLane.set(ref.id, lane);
      }
    }
  }

  return elementToLane;
}

/**
 * Build a map from element ID to estimated lane center Y.
 *
 * Used by the rebuild engine to pre-compute lane-aware Y positions
 * before calling computePositions().  Elements with a known lane
 * will be positioned at their lane's estimated center Y rather than
 * at their predecessor's Y (tasks 3a and 3c).
 *
 * The estimate is based on the topological lane order (sorted by
 * current Y) and the default lane height.  The actual lane heights
 * are computed later by resizePoolAndLanes() / handleAutosizePoolsAndLanes().
 *
 * @param lanes       All lane elements in the participant.
 * @param savedLaneMap  Element-ID → lane mapping captured before rebuild.
 * @param originY     Y origin for the first lane (matches rebuildLayout origin.y).
 */
export function buildElementLaneYMap(
  lanes: BpmnElement[],
  savedLaneMap: Map<string, BpmnElement>,
  originY: number
): Map<string, number> {
  if (lanes.length === 0 || savedLaneMap.size === 0) return new Map();

  // Sort lanes by current Y position to get top-to-bottom order.
  const sortedLanes = [...lanes].sort((a, b) => a.y - b.y);

  // Compute estimated center Y for each lane (stacked from originY).
  // Each lane occupies DEFAULT_LANE_HEIGHT pixels; center is at the midpoint.
  const laneCenterYs = new Map<string, number>();
  for (let i = 0; i < sortedLanes.length; i++) {
    laneCenterYs.set(
      sortedLanes[i].id,
      originY + i * DEFAULT_LANE_HEIGHT + DEFAULT_LANE_HEIGHT / 2
    );
  }

  // Map each element to its lane's estimated center Y.
  const elementLaneYs = new Map<string, number>();
  for (const [elId, lane] of savedLaneMap) {
    const laneY = laneCenterYs.get(lane.id);
    if (laneY !== undefined) elementLaneYs.set(elId, laneY);
  }

  return elementLaneYs;
}

// ── Lane layout application ────────────────────────────────────────────────

/**
 * Apply lane-aware Y positioning and resize lanes/pool.
 *
 * After the rebuild engine positions elements (correct X, default Y),
 * this function:
 * 1. Moves each element vertically to its assigned lane's center Y
 * 2. Re-layouts all sequence flow connections (Y positions changed)
 * 3. Resizes lanes and pool to fit the content (unless skipResize is true)
 *
 * @param savedLaneMap  Pre-computed element-to-lane mapping, captured
 *                      BEFORE the rebuild (movements mutate bpmn-js
 *                      lane assignments).
 * @param skipResize    When true, skip the pool/lane resize step (task 7b).
 *                      Use when the caller will run handleAutosizePoolsAndLanes
 *                      afterwards to avoid a redundant double-resize.
 * @returns Number of elements repositioned.
 */
/**
 * Spread co-column elements symmetrically around their lane's center Y.
 * Extracted to keep `applyLaneLayout` within cognitive-complexity limits.
 */
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

export function applyLaneLayout(
  registry: ElementRegistry,
  modeling: Modeling,
  participant: BpmnElement,
  originY: number,
  padding: number,
  savedLaneMap: Map<string, BpmnElement>,
  skipResize?: boolean
): number {
  const lanes = getLanesForParticipant(registry, participant);
  if (lanes.length === 0) return 0;

  // Sort lanes by original Y position (preserves lane ordering)
  const sortedLanes = [...lanes].sort((a, b) => a.y - b.y);

  // Compute lane center Y positions (stacked from originY)
  const laneCenterYs = new Map<string, number>();
  for (let i = 0; i < sortedLanes.length; i++) {
    laneCenterYs.set(sortedLanes[i].id, originY + i * DEFAULT_LANE_HEIGHT);
  }

  // Move elements to their lane's center Y.
  // Use savedLaneMap (not el.parent) so we catch elements that may
  // have been reparented when moveElements placed them outside pool bounds.
  //
  // When multiple elements share the same X column in one lane (e.g.
  // parallel branch tasks all assigned to the Reviewers lane), centering
  // them all at the same Y would stack them on top of each other.
  // Instead, distribute co-column elements symmetrically around the lane
  // center Y using BRANCH_SPREAD_SPACING between neighbours.
  const BRANCH_SPREAD_SPACING = 130; // matches DEFAULT_BRANCH_SPACING in engine

  let repositioned = 0;
  const allElements: BpmnElement[] = registry.getAll();
  const flowNodes = allElements.filter(
    (el) =>
      savedLaneMap.has(el.id) &&
      el.type !== SEQUENCE_FLOW_TYPE &&
      el.type !== 'bpmn:Lane' &&
      el.type !== 'bpmn:LaneSet' &&
      el.type !== 'label' &&
      // Boundary events follow their host via AttachSupport when the host moves.
      // Positioning them independently to lane-center Y breaks their host attachment.
      el.type !== 'bpmn:BoundaryEvent'
  );

  // Group elements by (laneId, columnX) so we can detect and spread
  // co-column siblings within a lane.
  const laneColumns = new Map<string, BpmnElement[]>(); // key: `${laneId}:${colX}`
  for (const el of flowNodes) {
    const lane = savedLaneMap.get(el.id);
    if (!lane) continue;
    if (laneCenterYs.get(lane.id) === undefined) continue;
    const colX = Math.round(el.x + el.width / 2);
    const key = `${lane.id}:${colX}`;
    if (!laneColumns.has(key)) laneColumns.set(key, []);
    laneColumns.get(key)!.push(el);
  }

  repositioned += spreadCoColumnElements(
    laneColumns,
    laneCenterYs,
    BRANCH_SPREAD_SPACING,
    modeling
  );

  // Resize pool and lanes to fit content BEFORE re-routing connections,
  // so that connection waypoints reflect the final pool/lane geometry.
  // Skip when the caller will run handleAutosizePoolsAndLanes afterwards (task 7b).
  if (!skipResize) {
    resizePoolAndLanes(sortedLanes, participant, registry, modeling, padding, savedLaneMap);
  }

  // Re-layout connections within the pool AFTER resize (task 9a):
  // waypoints now account for the final lane widths and heights.
  // For cross-lane flows, apply a smarter vertical-drop routing (task 3b/9b)
  // that avoids routing back through unrelated lanes.
  for (const el of allElements) {
    if (el.parent === participant && el.type === SEQUENCE_FLOW_TYPE) {
      try {
        // Reset stale waypoints before layout so ManhattanLayout computes
        // fresh orthogonal routing instead of being guided by creation-time
        // docking points that may exit the source from the wrong edge.
        resetStaleWaypoints(el);
        modeling.layoutConnection(el);
      } catch {
        // ManhattanLayout docking guard: skip connections with inconsistent waypoints.
      }
    }
  }

  // Post-process: improve waypoints for cross-lane sequence flows (tasks 3b, 9b).
  // After ManhattanLayout routes connections, cross-lane flows that go from one
  // lane to another may produce Z/U-paths that route through other lane regions.
  // Replace these with clean L-shaped paths (source right → target mid-Y → target).
  routeCrossLaneConnections(allElements, participant, savedLaneMap, modeling);

  return repositioned;
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

    // Check current waypoints exist — empty arrays can be skipped.
    const wps = flow.waypoints;
    if (!wps || wps.length === 0) continue;

    // Compute clean L-shaped route:
    // 1. Leave source's right edge at source center Y
    // 2. Drop/rise vertically at mid-X to target center Y
    // 3. Enter target's left edge at target center Y
    const srcRightX = src.x + (src.width || 0);
    const srcCenterY = src.y + (src.height || 0) / 2;
    const tgtLeftX = tgt.x;
    const tgtCenterY = tgt.y + (tgt.height || 0) / 2;

    // Mid-X is halfway between source right edge and target left edge
    const midX = Math.round((srcRightX + tgtLeftX) / 2);

    // Build a 4-waypoint L-shaped path: right → corner1 → corner2 → entry
    const cleanWaypoints = [
      { x: srcRightX, y: Math.round(srcCenterY) },
      { x: midX, y: Math.round(srcCenterY) },
      { x: midX, y: Math.round(tgtCenterY) },
      { x: tgtLeftX, y: Math.round(tgtCenterY) },
    ];

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

  // Clear existing flowNodeRef lists for affected lanes
  const affectedLaneIds = new Set<string>([...savedLaneMap.values()].map((l) => l.id));
  for (const lane of lanes) {
    if (!affectedLaneIds.has(lane.id)) continue;
    const refs = lane.businessObject?.flowNodeRef;
    if (Array.isArray(refs)) refs.length = 0;
  }

  // Re-populate from the saved map
  for (const [elementId, lane] of savedLaneMap) {
    const el = registry.get(elementId);
    if (!el || !lane.businessObject) continue;
    const laneBo = lane.businessObject;
    if (!Array.isArray(laneBo.flowNodeRef)) laneBo.flowNodeRef = [];
    const elBo = el.businessObject;
    if (elBo && !laneBo.flowNodeRef.includes(elBo)) {
      laneBo.flowNodeRef.push(elBo);
    }
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

  const allElements: BpmnElement[] = registry.getAll();
  const boundaryEvents = allElements.filter((el) => el.type === 'bpmn:BoundaryEvent' && el.host);

  for (const be of boundaryEvents) {
    const host = be.host!;
    const hostLane = savedLaneMap.get(host.id);
    if (!hostLane) continue;

    // Remove boundary event from any lane it's currently listed in.
    for (const lane of lanes) {
      const refs = lane.businessObject?.flowNodeRef;
      if (!Array.isArray(refs)) continue;
      const idx = refs.findIndex((r: any) => r?.id === be.businessObject?.id);
      if (idx !== -1) refs.splice(idx, 1);
    }

    // Add to the host's lane.
    const laneBo = hostLane.businessObject;
    if (!laneBo) continue;
    if (!Array.isArray(laneBo.flowNodeRef)) laneBo.flowNodeRef = [];
    const beBo = be.businessObject;
    if (beBo && !laneBo.flowNodeRef.includes(beBo)) {
      laneBo.flowNodeRef.push(beBo);
    }
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

  // For each lane, find element Y extents
  const laneExtents = sortedLanes.map((lane) => {
    const laneEls = flowNodes.filter((el) => elementToLane.get(el.id)?.id === lane.id);
    if (laneEls.length === 0) return null;
    const minY = Math.min(...laneEls.map((el) => el.y));
    const maxY = Math.max(...laneEls.map((el) => el.y + el.height));
    return { minY, maxY };
  });

  // Compute raw lane heights (content height + 2*padding, min MIN_LANE_HEIGHT)
  const rawHeights = laneExtents.map((ext) => {
    if (!ext) return MIN_LANE_HEIGHT;
    return Math.max(MIN_LANE_HEIGHT, ext.maxY - ext.minY + 2 * padding);
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

  for (let i = 0; i < sortedLanes.length; i++) {
    modeling.resizeShape(sortedLanes[i], {
      x: laneX,
      y: currentY,
      width: laneWidth,
      height: laneHeights[i],
    });
    currentY += laneHeights[i];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Compute the bounding box of flow elements inside a participant. */
function computePoolContentBBox(
  registry: ElementRegistry,
  participant: BpmnElement
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const allElements: BpmnElement[] = registry.getAll();
  const children = allElements.filter(
    (el) =>
      el.parent === participant &&
      el.type !== SEQUENCE_FLOW_TYPE &&
      el.type !== 'bpmn:Lane' &&
      el.type !== 'bpmn:LaneSet' &&
      el.type !== 'label'
  );

  if (children.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const child of children) {
    minX = Math.min(minX, child.x);
    minY = Math.min(minY, child.y);
    maxX = Math.max(maxX, child.x + child.width);
    maxY = Math.max(maxY, child.y + child.height);
  }

  return { minX, minY, maxX, maxY };
}
