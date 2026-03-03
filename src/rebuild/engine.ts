/**
 * Rebuild-based layout engine — core positioning algorithm.
 *
 * Repositions existing diagram elements using a topology-driven
 * forward pass.  Elements are moved (not recreated) to preserve
 * all business properties, IDs, and connections.
 *
 * Algorithm:
 *   1. Build container hierarchy and process inside-out
 *   2. Per container: extract flow graph and detect back-edges
 *   3. Topological sort with layer assignment
 *   4. Detect gateway split/merge patterns
 *   5. Forward pass: compute target positions left-to-right
 *   6. Apply positions via modeling.moveElements
 *   7. Position boundary events and exception chains
 *   8. Resize expanded subprocesses to fit contents
 *   9. Position artifacts (text annotations, data objects) near associated nodes
 *   10. Layout all connections (forward flows + back-edges + exception chains)
 *   11. Stack pools vertically for collaborations
 *   12. Adjust labels to bpmn-js default positions
 */

import type { DiagramState } from '../types';
import {
  type BpmnElement,
  type ElementRegistry,
  type EventBus,
  type Modeling,
  getService,
} from '../bpmn-types';
import { STANDARD_BPMN_GAP } from '../constants';
import { extractFlowGraph, type FlowGraph } from './topology';
import { detectBackEdges, topologicalSort } from './graph';
import { detectGatewayPatterns } from './patterns';
import { identifyBoundaryEvents } from './boundary';
import { resetStaleWaypoints } from './waypoints';
import {
  buildContainerHierarchy,
  getContainerRebuildOrder,
  moveElementTo,
  collectExceptionChainIds,
  positionBoundaryEventsAndChains,
  resizeSubprocessToFit,
  stackPools,
  layoutMessageFlows,
  getEventSubprocessIds,
  positionEventSubprocesses,
} from './container-layout';
import { buildPatternLookups, computePositions, resolvePositionOverlaps } from './positioning';
import {
  applyLaneLayout,
  buildElementToLaneMap,
  buildElementLaneYMap,
  getLanesForParticipant,
  resizePoolToFit,
  restoreLaneAssignments,
  syncBoundaryEventLanes,
} from './lane-layout';
import { positionArtifacts, adjustLabels } from './artifacts';

// ── Types ──────────────────────────────────────────────────────────────────

/** Options for the rebuild layout engine. */
export interface RebuildOptions {
  /** Origin position for the first start event (center coordinates). */
  origin?: { x: number; y: number };
  /** Edge-to-edge gap between consecutive elements (default: 50). */
  gap?: number;
  /**
   * Vertical centre-to-centre spacing between gateway branches.
   * Default: 130 (task height 80 + standard gap 50).
   */
  branchSpacing?: number;
  /**
   * Set of element IDs that should not be repositioned (pinned elements).
   * The rebuild engine will skip these elements and place other elements
   * around them.
   */
  pinnedElementIds?: Set<string>;
  /**
   * When true, skip the internal pool/lane resize that normally runs after
   * element positioning.  Use this when the caller intends to run
   * `autosize_bpmn_pools_and_lanes` (or `handleAutosizePoolsAndLanes`)
   * afterwards, to avoid a redundant double-resize.
   *
   * Task 7b: `rebuildLayout` uses a proportional lane-height algorithm
   * (`resizePoolAndLanes`) while `handleAutosizePoolsAndLanes` uses the
   * `autosize-pools-and-lanes` handler algorithm.  When `poolExpansion`
   * is enabled in `handleLayoutDiagram`, the handler calls
   * `handleAutosizePoolsAndLanes` after rebuild, which overrides the
   * internal resize anyway — setting this flag avoids the redundant step.
   */
  skipPoolResize?: boolean;
}

/** Result returned by the rebuild layout engine. */
export interface RebuildResult {
  /** Number of elements repositioned. */
  repositionedCount: number;
  /** Number of connections re-routed. */
  reroutedCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Default origin for the first start event (center coordinates). */
const DEFAULT_ORIGIN = { x: 180, y: 200 };

/**
 * Default vertical centre-to-centre spacing between gateway branches.
 * Matches typical BPMN layout: task height (80) + standard gap (50).
 */
const DEFAULT_BRANCH_SPACING = 130;

/**
 * Padding (px) inside an expanded subprocess around its internal
 * elements.  Applied on all four sides.
 */
const SUBPROCESS_PADDING = 40;

/** Gap (px) between stacked participant pools. */
const POOL_GAP = 68;

// ── Main rebuild function ──────────────────────────────────────────────────

/**
 * Rebuild the layout of a diagram by repositioning elements using
 * topology-driven placement.
 *
 * Does NOT create or delete elements — only moves them.  All business
 * properties, IDs, and connections are preserved.
 *
 * Handles containers (subprocesses, participants) by rebuilding
 * inside-out: deepest containers first, then their parents.
 *
 * @param diagram  The diagram state to rebuild.
 * @param options  Optional configuration for origin, gap, and branch spacing.
 * @returns        Summary of repositioned elements and re-routed connections.
 */
export function rebuildLayout(diagram: DiagramState, options?: RebuildOptions): RebuildResult {
  const modeler = diagram.modeler;
  const modeling = getService(modeler, 'modeling');
  const registry = getService(modeler, 'elementRegistry');
  const eventBus = getService(modeler, 'eventBus');

  const origin = options?.origin ?? DEFAULT_ORIGIN;
  const gap = options?.gap ?? STANDARD_BPMN_GAP;
  const branchSpacing = options?.branchSpacing ?? DEFAULT_BRANCH_SPACING;
  const pinnedElementIds = options?.pinnedElementIds;
  const skipPoolResize = options?.skipPoolResize ?? false;

  const hierarchy = buildContainerHierarchy(registry);
  const rebuildOrder = getContainerRebuildOrder(hierarchy);

  let totalRepositioned = 0;
  let totalRerouted = 0;
  const rebuiltParticipants: BpmnElement[] = [];

  for (const containerNode of rebuildOrder) {
    const counts = processContainerNode(
      containerNode,
      registry,
      modeling,
      origin,
      gap,
      branchSpacing,
      pinnedElementIds,
      rebuiltParticipants,
      skipPoolResize,
      eventBus
    );
    totalRepositioned += counts.repositionedCount;
    totalRerouted += counts.reroutedCount;
  }

  if (rebuiltParticipants.length > 1) {
    totalRepositioned += stackPools(rebuiltParticipants, modeling, POOL_GAP);
  }

  totalRerouted += layoutMessageFlows(registry, modeling);
  totalRepositioned += adjustLabels(registry, modeling);

  return { repositionedCount: totalRepositioned, reroutedCount: totalRerouted };
}

// ── Per-container processing ───────────────────────────────────────────────

/**
 * Process a single container node in the rebuild order.
 * Returns repositioned/rerouted counts (zeros for skipped containers).
 */
function processContainerNode(
  containerNode: ReturnType<typeof getContainerRebuildOrder>[number],
  registry: ElementRegistry,
  modeling: Modeling,
  origin: { x: number; y: number },
  gap: number,
  branchSpacing: number,
  pinnedElementIds: Set<string> | undefined,
  rebuiltParticipants: BpmnElement[],
  skipPoolResize: boolean,
  eventBus: EventBus
): RebuildResult {
  const container = containerNode.element;

  // Skip Collaboration root — it doesn't hold flow nodes directly
  if (container.type === 'bpmn:Collaboration') return { repositionedCount: 0, reroutedCount: 0 };

  // Use subprocess-internal origin for subprocesses
  const containerOrigin =
    container.type === 'bpmn:SubProcess' ? { x: SUBPROCESS_PADDING + 18, y: origin.y } : origin;

  // Detect event subprocesses to exclude from main flow positioning
  const eventSubIds = getEventSubprocessIds(registry, container);

  // Save lane assignments BEFORE rebuild — bpmn-js mutates flowNodeRef
  // when elements are moved, so we need the original mapping.
  const participantLanes =
    container.type === 'bpmn:Participant' ? getLanesForParticipant(registry, container) : [];
  const savedLaneMap =
    participantLanes.length > 0
      ? buildElementToLaneMap(participantLanes, registry)
      : new Map<string, BpmnElement>();

  // Lane-aware positioning: precompute element → lane center Y (tasks 3a/3c)
  const elementLaneYs =
    participantLanes.length > 0 ? buildElementLaneYMap(participantLanes, savedLaneMap) : undefined;

  const result = rebuildContainer(
    registry,
    modeling,
    container,
    containerOrigin,
    gap,
    branchSpacing,
    eventSubIds,
    pinnedElementIds,
    elementLaneYs,
    eventBus
  );

  let repositionedCount = result.repositionedCount;
  const reroutedCount = result.reroutedCount;

  if (eventSubIds.size > 0) {
    repositionedCount += positionEventSubprocesses(
      eventSubIds,
      registry,
      modeling,
      container,
      gap,
      containerOrigin.x
    );
  }

  if (container.type === 'bpmn:SubProcess' && containerNode.isExpanded) {
    resizeSubprocessToFit(modeling, registry, container, SUBPROCESS_PADDING);
  }

  repositionedCount += positionArtifacts(registry, modeling, container);

  if (container.type === 'bpmn:Participant') {
    repositionedCount += applyParticipantLayout(
      container,
      participantLanes,
      savedLaneMap,
      registry,
      modeling,
      origin,
      rebuiltParticipants,
      skipPoolResize
    );

    // Clamp connection waypoints so none escape outside the pool Y bounds
    // (TODO #1: normaliseOrigin shifts elements but not waypoints).
    clampConnectionWaypointsToParticipant(container, registry, modeling);

    if (participantLanes.length > 0) {
      // Sync boundary event lane membership to their host's lane (issue #14).
      // Must run after applyParticipantLayout because the lane assignment
      // can be mutated when elements are moved during layout.
      syncBoundaryEventLanes(registry, savedLaneMap, participantLanes);
    }
  }

  return { repositionedCount, reroutedCount };
}

/**
 * Apply lane layout (or pool-fit resize) for a participant container.
 * Pushes the participant to `rebuiltParticipants` for pool stacking.
 *
 * @param skipPoolResize  When true, skip the internal pool/lane resize step.
 *   Use when the caller will run `handleAutosizePoolsAndLanes` afterwards
 *   (task 7b: avoids redundant double-resize with a different algorithm).
 */
function applyParticipantLayout(
  container: BpmnElement,
  participantLanes: BpmnElement[],
  savedLaneMap: Map<string, BpmnElement>,
  registry: ElementRegistry,
  modeling: Modeling,
  origin: { x: number; y: number },
  rebuiltParticipants: BpmnElement[],
  skipPoolResize: boolean
): number {
  let repositioned = 0;
  if (participantLanes.length > 0) {
    restoreLaneAssignments(registry, savedLaneMap, participantLanes);
    repositioned += applyLaneLayout(
      registry,
      modeling,
      container,
      SUBPROCESS_PADDING,
      savedLaneMap,
      skipPoolResize
    );
  } else if (!skipPoolResize) {
    resizePoolToFit(modeling, registry, container, SUBPROCESS_PADDING);
  }
  rebuiltParticipants.push(container);
  return repositioned;
}

// ── Container rebuild ──────────────────────────────────────────────────────

/**
 * Rebuild the layout of a single container scope (Process, Participant,
 * or SubProcess).  Positions flow nodes, boundary events, and exception
 * chains within the container.
 */
function rebuildContainer(
  registry: ElementRegistry,
  modeling: Modeling,
  container: BpmnElement,
  origin: { x: number; y: number },
  gap: number,
  branchSpacing: number,
  additionalExcludeIds?: Set<string>,
  pinnedElementIds?: Set<string>,
  elementLaneYs?: Map<string, number>,
  eventBus?: EventBus
): RebuildResult {
  // Extract flow graph scoped to this container
  const graph = extractFlowGraph(registry, container);
  if (graph.nodes.size === 0) {
    return { repositionedCount: 0, reroutedCount: 0 };
  }

  // Identify boundary events and collect exception chain IDs to skip
  const boundaryInfos = identifyBoundaryEvents(registry, container);
  const exceptionChainIds = collectExceptionChainIds(boundaryInfos);

  // Merge all exclude IDs (exception chains + event subprocesses)
  const allExcludeIds = new Set([...exceptionChainIds, ...(additionalExcludeIds ?? [])]);

  // Topology analysis
  const backEdgeIds = detectBackEdges(graph);
  const sorted = topologicalSort(graph, backEdgeIds);
  const patterns = detectGatewayPatterns(graph, backEdgeIds);
  const { mergeToPattern, elementToBranch } = buildPatternLookups(patterns);

  // Compute positions (skipping exception chain elements + event subprocesses)
  const positions = computePositions(
    graph,
    sorted,
    backEdgeIds,
    mergeToPattern,
    elementToBranch,
    origin,
    gap,
    branchSpacing,
    allExcludeIds,
    elementLaneYs
  );

  // Safety-net: spread any overlapping elements (e.g. open-fan parallel branches)
  resolvePositionOverlaps(positions, branchSpacing);

  // Apply positions (skip pinned elements)
  let repositionedCount = 0;
  for (const [id, target] of positions) {
    if (pinnedElementIds?.has(id)) continue;
    const element = registry.get(id);
    if (!element) continue;
    if (moveElementTo(modeling, element, target)) {
      repositionedCount++;
    }
  }

  // Layout main flow connections
  let reroutedCount = layoutConnections(graph, backEdgeIds, registry, modeling);

  // Position boundary events and exception chains
  const boundaryResult = positionBoundaryEventsAndChains(
    boundaryInfos,
    positions,
    registry,
    modeling,
    gap,
    eventBus
  );
  repositionedCount += boundaryResult.repositionedCount;
  reroutedCount += boundaryResult.reroutedCount;

  return { repositionedCount, reroutedCount };
}

// ── Waypoint clamping ──────────────────────────────────────────────────────

/**
 * Clamp all sequence-flow waypoints so none fall outside the enclosing
 * participant's Y range.
 *
 * After pool resize (which may expand downward to include boundary-event
 * exception chains), bpmn-js's ManhattanLayout occasionally produces
 * intermediate waypoints that escape slightly above or below the pool
 * boundary.  This pass corrects them (TODO #1).
 *
 * Only sequence flows whose `parent` is the participant are considered;
 * message flows between pools are intentionally left untouched.
 *
 * @param container  The participant element whose waypoints to clamp.
 * @param registry   Element registry for the diagram.
 * @param modeling   Modeling service for waypoint updates.
 */
function clampConnectionWaypointsToParticipant(
  container: BpmnElement,
  registry: ElementRegistry,
  modeling: Modeling
): void {
  const poolTop = container.y;
  const poolBottom = container.y + container.height;

  const allElements = registry.getAll();
  for (const el of allElements) {
    if (el.type !== 'bpmn:SequenceFlow') continue;
    const waypoints = el.waypoints;
    if (!waypoints || waypoints.length === 0) continue;

    // Only clamp flows that belong to this participant's process
    if (el.parent !== container) continue;

    const newWaypoints = waypoints.map((wp) => ({
      ...wp,
      y: Math.max(poolTop, Math.min(poolBottom, wp.y)),
    }));

    const changed = newWaypoints.some((wp, i) => wp.y !== waypoints[i].y);
    if (changed) {
      modeling.updateWaypoints(el, newWaypoints);
    }
  }
}

// ── Connection layout ──────────────────────────────────────────────────────

/**
 * Re-layout all sequence flow connections after element repositioning.
 * Forward flows are laid out first, then back-edges (loops).
 *
 * Uses bpmn-js ManhattanLayout via modeling.layoutConnection() which
 * computes orthogonal waypoints based on element positions.
 */
function layoutConnections(
  graph: FlowGraph,
  backEdgeIds: Set<string>,
  registry: ElementRegistry,
  modeling: Modeling
): number {
  let count = 0;

  // Layout forward connections first
  for (const [, node] of graph.nodes) {
    for (let i = 0; i < node.outgoing.length; i++) {
      const flowId = node.outgoingFlowIds[i];
      if (backEdgeIds.has(flowId)) continue;
      const conn = registry.get(flowId);
      if (conn) {
        try {
          // Fix stale waypoints from intermediate element moves that cause
          // same-level connections to route upward instead of straight
          resetStaleWaypoints(conn);
          modeling.layoutConnection(conn);
          count++;
        } catch {
          // ManhattanLayout throws "unexpected dockingDirection" when waypoints are
          // inconsistent. Skip silently — element still appears in the diagram.
        }
      }
    }
  }

  // Layout back-edge connections (loops)
  for (const flowId of backEdgeIds) {
    const conn = registry.get(flowId);
    if (conn) {
      try {
        resetStaleWaypoints(conn);
        modeling.layoutConnection(conn);
        count++;
      } catch {
        // Same docking guard for back-edge (loop) connections.
      }
    }
  }

  return count;
}
