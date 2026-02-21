/**
 * ELK-based layout engine for BPMN diagrams.
 *
 * Uses elkjs (Eclipse Layout Kernel) with the Sugiyama layered algorithm
 * to produce clean left-to-right layouts.  Handles flat processes,
 * collaborations with participants, and expanded subprocesses as compound
 * nodes.
 *
 * Boundary events are excluded from the ELK graph — they follow their
 * host element automatically when bpmn-js moves the host.
 *
 * Post-layout pipeline:
 * 1. ELK positions nodes → applyElkPositions()
 * 2. Resize compound nodes to ELK-computed sizes → resizeCompoundNodes()
 * 3. Fix stranded boundary events → repositionBoundaryEvents()
 * 4. Snap same-layer elements to common Y → snapSameLayerElements()
 * 5. Grid snap pass (uniform columns + vertical spacing) → gridSnapPass()
 * 5.5. Align happy-path to single Y-centre → alignHappyPath()
 * 6. Reposition artifacts → repositionArtifacts()
 * 7. Apply ELK edge sections as waypoints → applyElkEdgeRoutes()
 * 7.5. Route branch connections through inter-column channels → routeBranchConnectionsThroughChannels()
 * 8. Repair disconnected edge endpoints → fixDisconnectedEdges()
 * 8.3. Snap endpoints to shape boundaries → croppingDockPass() (D1-3, replaces snapEndpointsToElementCentres)
 * 8.5. Simplify collinear waypoints → simplifyCollinearWaypoints()
 * 8.6. Remove micro-bends and short-segment staircases → removeMicroBends()
 * 8.7. Separate overlapping collinear gateway flows → separateOverlappingGatewayFlows()
 * 8.8. Route loopback (backward) flows below main path → routeLoopbacksBelow()
 * 9. Final orthogonal snap → snapAllConnectionsOrthogonal()
 * 9.5. Clamp intra-lane flow waypoints to lane bounds → clampFlowsToLaneBounds()
 * 10. Reduce edge crossings → reduceCrossings()
 * 11. Detect crossing flows → detectCrossingFlows()
 */

import type { DiagramState } from '../types';
import type { ElkExtendedEdge, LayoutOptions } from 'elkjs';

import type { BpmnElement, ElementRegistry, Canvas } from '../bpmn-types';
import { CachedElementRegistry } from './cached-registry';
import {
  ELK_LAYOUT_OPTIONS,
  ORIGIN_OFFSET_X,
  ORIGIN_OFFSET_Y,
  ELK_HIGH_PRIORITY,
  ELK_CROSSING_THOROUGHNESS,
} from './constants';
import {
  ELK_COMPACT_NODE_SPACING,
  ELK_COMPACT_LAYER_SPACING,
  ELK_SPACIOUS_NODE_SPACING,
  ELK_SPACIOUS_LAYER_SPACING,
} from '../constants.js';
import { buildContainerGraph } from './graph-builder';
import {
  applyElkPositions,
  resizeCompoundNodes,
  positionEventSubprocesses,
  centreElementsInPools,
  enforceExpandedPoolGap,
  reorderCollapsedPoolsBelow,
  compactPools,
  normaliseOrigin,
  repositionAdHocSubprocessChildren,
} from './position-application';
import {
  repositionLanes,
  saveLaneNodeAssignments,
  clampFlowsToLaneBounds,
  routeCrossLaneStaircase,
} from './lane-layout';
import {
  repositionBoundaryEvents,
  saveBoundaryEventData,
  restoreBoundaryEventData,
  identifyBoundaryExceptionChains,
  repositionBoundaryEventTargets,
  alignOffPathEndEventsToSecondRow,
  pushBoundaryTargetsBelowHappyPath,
  repositionCompensationHandlers,
} from './boundary-events';
import {
  snapSameLayerElements,
  snapAllConnectionsOrthogonal,
  snapExpandedSubprocesses,
} from './snap-alignment';
import {
  applyElkEdgeRoutes,
  fixDisconnectedEdges,
  simplifyCollinearWaypoints,
  simplifyGatewayBranchRoutes,
  croppingDockPass,
  rebuildOffRowGatewayRoutes,
  separateOverlappingGatewayFlows,
  removeMicroBends,
  routeLoopbacksBelow,
  routeSelfLoops,
  spaceParallelMessageFlows,
  bundleParallelFlows,
} from './edge-routing';
import { repositionArtifacts } from './artifacts';
import { routeBranchConnectionsThroughChannels } from './channel-routing';
import { detectHappyPath } from './happy-path';
import {
  gridSnapPass,
  gridSnapExpandedSubprocesses,
  alignHappyPath,
  alignOffPathEndEvents,
  pinHappyPathBranches,
} from './grid-snap';
import { detectCrossingFlows, reduceCrossings } from './crossing-detection';
import { avoidElementIntersections } from './element-avoidance';
import { resolveOverlaps } from './overlap-resolution';
import type { ElkLayoutOptions, LayoutContext, PipelineStep } from './types';
import { createLayoutLogger, type PositionSnapshot } from './layout-logger';
import { PipelineRunner } from './pipeline-runner';

export type {
  ElkLayoutOptions,
  CrossingFlowsResult,
  GridLayer,
  BpmnElkOptions,
  LayoutContext,
  PipelineStep,
} from './types';

export { PipelineRunner } from './pipeline-runner';
export { elkLayoutSubset } from './subset-layout';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * B7: Snapshot the { x, y } position of every layout-able shape in the
 * element registry.  Used by `stepWithDelta()` to compute how many elements
 * a pipeline step moved.
 */
function snapshotPositions(registry: ElementRegistry): PositionSnapshot {
  const snap: PositionSnapshot = new Map();
  for (const el of registry.getAll()) {
    // Only shapes have width/height; connections and root element do not.
    if (el.width !== undefined) {
      snap.set(el.id, { x: el.x ?? 0, y: el.y ?? 0 });
    }
  }
  return snap;
}

/**
 * B7: Count how many elements moved by more than 1 px in either axis
 * since the given snapshot was taken.
 */
function countMovedElements(registry: ElementRegistry, before: PositionSnapshot): number {
  let moved = 0;
  for (const [id, pos] of before) {
    const el = registry.get(id);
    if (
      el !== undefined &&
      (Math.abs((el.x ?? 0) - pos.x) > 1 || Math.abs((el.y ?? 0) - pos.y) > 1)
    ) {
      moved++;
    }
  }
  return moved;
}

/**
 * Run a callback once per participant scope, or once at root level
 * if the diagram has no participants (plain process).
 *
 * Eliminates the repeated pattern:
 * ```
 * const participants = elementRegistry.filter(…);
 * if (participants.length > 0) {
 *   for (const p of participants) callback(p);
 * } else {
 *   callback(undefined);
 * }
 * ```
 */
function forEachScope(
  elementRegistry: ElementRegistry,
  callback: (scope?: BpmnElement) => void
): void {
  const participants = elementRegistry.filter((el) => el.type === 'bpmn:Participant');
  if (participants.length > 0) {
    for (const participant of participants) {
      callback(participant);
    }
  } else {
    callback(undefined);
  }
}

/**
 * Build ELK LayoutOptions from user-supplied ElkLayoutOptions,
 * merging direction, compactness presets, and explicit spacing overrides.
 */
function resolveLayoutOptions(options?: ElkLayoutOptions): {
  layoutOptions: LayoutOptions;
  effectiveLayerSpacing: number | undefined;
} {
  const layoutOptions: LayoutOptions = { ...ELK_LAYOUT_OPTIONS };

  if (options?.direction) {
    layoutOptions['elk.direction'] = options.direction;
  }

  // Apply compactness presets (overridden by explicit nodeSpacing/layerSpacing)
  let effectiveLayerSpacing: number | undefined;
  if (options?.compactness === 'compact') {
    layoutOptions['elk.spacing.nodeNode'] = String(ELK_COMPACT_NODE_SPACING);
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(ELK_COMPACT_LAYER_SPACING);
    effectiveLayerSpacing = ELK_COMPACT_LAYER_SPACING;
  } else if (options?.compactness === 'spacious') {
    layoutOptions['elk.spacing.nodeNode'] = String(ELK_SPACIOUS_NODE_SPACING);
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(ELK_SPACIOUS_LAYER_SPACING);
    effectiveLayerSpacing = ELK_SPACIOUS_LAYER_SPACING;
  }

  // Explicit spacing values override compactness presets
  if (options?.nodeSpacing !== undefined) {
    layoutOptions['elk.spacing.nodeNode'] = String(options.nodeSpacing);
  }
  if (options?.layerSpacing !== undefined) {
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(options.layerSpacing);
    effectiveLayerSpacing = options.layerSpacing;
  }

  // Happy-path emphasis: prioritise default/first-connected branch
  layoutOptions['elk.layered.crossingMinimization.thoroughness'] = ELK_CROSSING_THOROUGHNESS;
  // Only consider model order when we have diverse Y positions (imported layouts).
  // For simple linear flows (hasDiverseY=false), let ELK optimize freely.

  return { layoutOptions, effectiveLayerSpacing };
}

// ── Layout pipeline context ─────────────────────────────────────────────────

// LayoutContext is defined in and exported from `./types` (B1-2).
// It is imported above via `import type { ElkLayoutOptions, LayoutContext }`.

// ── Pipeline step functions ─────────────────────────────────────────────────

/** Apply ELK-computed node positions and resize compound nodes. */
async function applyNodePositions(ctx: LayoutContext): Promise<void> {
  applyElkPositions(ctx.elementRegistry, ctx.modeling, ctx.result, ctx.offsetX, ctx.offsetY);
  resizeCompoundNodes(ctx.elementRegistry, ctx.modeling, ctx.result);
  // G5: Rearrange children of ad-hoc subprocesses in a grid layout.
  // Ad-hoc subprocesses have unordered activities that should be arranged in a
  // matrix pattern instead of the default sequential Sugiyama layout.
  repositionAdHocSubprocessChildren(ctx.elementRegistry, ctx.modeling);
  // NOTE: event subprocesses are NOT positioned here — they are placed in a
  // separate pipeline step after all alignment passes so that the main-flow
  // bounds used to anchor them are stable (see 'positionEventSubprocesses' step).
}

/** Restore boundary event data and reposition boundary events. */
function fixBoundaryEvents(ctx: LayoutContext): void {
  restoreBoundaryEventData(ctx.elementRegistry, ctx.boundarySnapshots);
  repositionBoundaryEvents(ctx.elementRegistry, ctx.modeling, ctx.boundarySnapshots);
}

/**
 * Snap same-layer elements to common Y (fixes 5–10 px offsets).
 * Scoped per-participant for collaborations, and recursively for
 * expanded subprocesses to avoid cross-nesting-level mixing.
 */
function snapAndAlignLayers(ctx: LayoutContext): void {
  forEachScope(ctx.elementRegistry, (scope) => {
    snapSameLayerElements(ctx.elementRegistry, ctx.modeling, scope);
    snapExpandedSubprocesses(ctx.elementRegistry, ctx.modeling, scope);
  });
}

/**
 * Post-ELK grid snap pass — quantises node positions to a virtual grid
 * for visual regularity.  Also resolves overlaps created by grid snap.
 *
 * B3: Grid snap and overlap resolution are combined into a single
 * `forEachScope` pass.  Pool scopes are independent — gridSnap(A) never
 * affects elements in pool B — so running [gridSnap + resolveOverlaps]
 * per scope is semantically equivalent to two separate full-scope loops.
 */
function gridSnapAndResolveOverlaps(ctx: LayoutContext): void {
  const shouldGridSnap = ctx.options?.gridSnap !== false;
  if (!shouldGridSnap) return;

  // Grid snap is a horizontal-layout algorithm (column-based X snapping).
  // Skip it for vertical (DOWN/UP) layouts — ELK already positions nodes
  // optimally and the horizontal column logic would corrupt Y-primary layouts.
  const effectiveDirection = ctx.options?.direction || 'RIGHT';
  if (effectiveDirection === 'DOWN' || effectiveDirection === 'UP') return;

  forEachScope(ctx.elementRegistry, (scope) => {
    gridSnapPass(
      ctx.elementRegistry,
      ctx.modeling,
      ctx.happyPathEdgeIds,
      scope,
      ctx.effectiveLayerSpacing
    );
    gridSnapExpandedSubprocesses(
      ctx.elementRegistry,
      ctx.modeling,
      ctx.happyPathEdgeIds,
      scope,
      ctx.effectiveLayerSpacing
    );
    // Resolve overlaps created by grid quantisation within this scope
    resolveOverlaps(ctx.elementRegistry, ctx.modeling, scope);
  });
}

/**
 * Align happy-path elements to a single Y-centre and align off-path
 * end events with their predecessor.  Only applies for horizontal layouts.
 */
function alignHappyPathAndOffPathEvents(ctx: LayoutContext): void {
  const shouldPreserveHappyPath = ctx.options?.preserveHappyPath !== false;
  const effectiveDirection = ctx.options?.direction || 'RIGHT';

  if (
    !shouldPreserveHappyPath ||
    !ctx.happyPathEdgeIds ||
    ctx.happyPathEdgeIds.size === 0 ||
    (effectiveDirection !== 'RIGHT' && effectiveDirection !== 'LEFT')
  ) {
    return;
  }

  // B3: All three alignment passes share a single forEachScope loop.
  // The dependency order (alignHappyPath → alignOffPathEndEvents →
  // pinHappyPathBranches) is preserved within each scope.  Pool scopes
  // are independent, so interleaving is semantically equivalent to three
  // separate full-scope passes.
  forEachScope(ctx.elementRegistry, (scope) => {
    alignHappyPath(ctx.elementRegistry, ctx.modeling, ctx.happyPathEdgeIds, scope, ctx.hasDiverseY);
    alignOffPathEndEvents(ctx.elementRegistry, ctx.modeling, ctx.happyPathEdgeIds, scope);
    // Pin happy-path branches above off-path branches at exclusive/inclusive gateways
    pinHappyPathBranches(ctx.elementRegistry, ctx.modeling, ctx.happyPathEdgeIds, scope);
  });
}

/**
 * Centre elements in pools, reposition lanes, and reorder collapsed
 * pools below expanded pools.
 */
function finalisePoolsAndLanes(ctx: LayoutContext): void {
  centreElementsInPools(ctx.elementRegistry, ctx.modeling);
  enforceExpandedPoolGap(ctx.elementRegistry, ctx.modeling);
  repositionLanes(
    ctx.elementRegistry,
    ctx.modeling,
    ctx.laneSnapshots,
    ctx.options?.laneStrategy,
    ctx.options?.direction
  );
  compactPools(ctx.elementRegistry, ctx.modeling);
  reorderCollapsedPoolsBelow(ctx.elementRegistry, ctx.modeling);
}

/**
 * Final boundary event restore/reposition, then position boundary-only
 * leaf targets and align off-path end events to the boundary target row.
 *
 * ## B2: Why two restore+reposition cycles?
 *
 * Boundary event data is saved once in `ctx.boundarySnapshots` (before
 * `applyElkPositions`).  It is then restored+repositioned **twice** in the
 * pipeline:
 *
 * **Cycle 1 — `fixBoundaryEvents` (step 3):**
 * `applyElkPositions` calls `modeling.moveElements` on each host task, which
 * drags attached boundary events via bpmn-js's `DetachEventBehavior`.  The
 * drag often places boundary events at the wrong host border (ELK knows host
 * positions but not which border the BEs should sit on).  Cycle 1 restores
 * the pre-ELK border and position for every boundary event.
 *
 * **Cycle 2 — `finaliseBoundaryTargets` (this function, step 10):**
 * Between cycle 1 and cycle 2, six pipeline steps move host elements:
 *   - `snapAndAlignLayers` (step 4) — Y-snaps hosts to a common row
 *   - `gridSnapAndResolveOverlaps` (step 5) — quantises host X/Y
 *   - `alignHappyPathAndOffPathEvents` (step 7) — nudges hosts along happy-path row
 *   - `resolveOverlaps (2nd pass)` (step 8) — pushes hosts apart vertically
 *   - `finalisePoolsAndLanes` (step 9) — repositions lanes, which shifts hosts
 * Each of these moves the host element and, through bpmn-js's auto-drag,
 * the attached boundary event.  After all host moves are complete, cycle 2
 * re-snaps every boundary event to its correct border position.
 *
 * ## Consolidation potential (B2)
 * Consolidating to a single cycle would require: (a) deferring all host
 * moves until after cycle 1, then (b) running one final restore.  This is
 * architecturally complex because `snapAndAlignLayers`, `gridSnapPass`, and
 * `alignHappyPath` all modify host positions for good visual reasons and
 * are not easily deferred.  The two-cycle approach is the simplest correct
 * solution.  Future work: if D6 (command-stack integration for boundary
 * events) is solved, boundary events could follow their host natively
 * without any explicit restore cycles.
 */
function finaliseBoundaryTargets(ctx: LayoutContext): void {
  // Re-restore after snap/grid passes may have moved host tasks
  restoreBoundaryEventData(ctx.elementRegistry, ctx.boundarySnapshots);
  repositionBoundaryEvents(ctx.elementRegistry, ctx.modeling, ctx.boundarySnapshots);

  repositionBoundaryEventTargets(ctx.elementRegistry, ctx.modeling, ctx.boundaryLeafTargetIds);

  // Push non-leaf boundary event targets that ELK placed above the happy
  // path down below it (e.g. retry/fix tasks attached via boundary events).
  pushBoundaryTargetsBelowHappyPath(
    ctx.elementRegistry,
    ctx.modeling,
    ctx.boundaryLeafTargetIds,
    ctx.happyPathEdgeIds
  );

  alignOffPathEndEventsToSecondRow(
    ctx.elementRegistry,
    ctx.modeling,
    ctx.boundaryLeafTargetIds,
    ctx.happyPathEdgeIds
  );

  // Reposition compensation handler tasks (G2).
  // Compensation handlers are connected to their compensation boundary event
  // via bpmn:Association (not sequence flow), so ELK has no knowledge of
  // where to place them.  We position them below the host task here, after
  // all ELK-driven positioning is complete.
  repositionCompensationHandlers(ctx.elementRegistry, ctx.modeling);
}

/**
 * Apply ELK edge routes, simplify gateway branch routes, and route
 * branch connections through inter-column channels.
 */
function applyEdgeRoutes(ctx: LayoutContext): void {
  applyElkEdgeRoutes(ctx.elementRegistry, ctx.modeling, ctx.result, ctx.offsetX, ctx.offsetY);

  // Route self-loop connections (source === target) which ELK does not handle.
  // Must run immediately after applyElkEdgeRoutes so that subsequent
  // simplification passes do not see stale zero-length waypoints.
  routeSelfLoops(ctx.elementRegistry, ctx.modeling);

  // E2: Space parallel message flows whose horizontal segments would otherwise
  // overlap.  Must run after applyElkEdgeRoutes assigns initial dog-leg routes
  // and before simplifyCollinearWaypoints which could merge the spaced segments.
  spaceParallelMessageFlows(ctx.elementRegistry, ctx.modeling);

  const shouldGridSnap = ctx.options?.gridSnap !== false;
  if (shouldGridSnap) {
    const shouldSimplifyRoutes = ctx.options?.simplifyRoutes !== false;
    if (shouldSimplifyRoutes) {
      simplifyGatewayBranchRoutes(ctx.elementRegistry, ctx.modeling);
    }

    forEachScope(ctx.elementRegistry, (scope) => {
      routeBranchConnectionsThroughChannels(ctx.elementRegistry, ctx.modeling, scope);
    });
  }
}

/**
 * B4 — Edge routing sub-step dependency order (preserved in REPAIR_SIMPLIFY_SUBSTEPS).
 *
 * The sub-steps below have strict ordering dependencies.  Reordering
 * them will produce incorrect or degraded routes.
 *
 * ```
 * fixDisconnectedEdges          — requires: element positions; provides: connected endpoints
 * croppingDockPass              — requires: connected endpoints; provides: shape-boundary-aligned endpoints
 *                                 (D1-3: replaces snapEndpointsToElementCentres; uses CroppingConnectionDocking
 *                                 for accurate endpoint placement on circles/diamonds/rounded-rects)
 * rebuildOffRowGatewayRoutes    — requires: boundary-aligned endpoints; provides: L/Z-bend routes
 * separateOverlappingGatewayFlows — requires: L/Z-bend routes; provides: non-overlapping collinear flows
 * simplifyCollinearWaypoints    — requires: non-overlapping routes; provides: minimal-waypoint routes
 *                                 (must run after separation so the merged segments are clean)
 * removeMicroBends              — requires: simplified routes; provides: smooth orthogonal routes
 *                                 (must run after simplification to catch new near-collinear triples)
 * routeLoopbacksBelow           — requires: all positions finalised; provides: U-shape loopback routes
 *                                 (must run last because it uses the scope bottom/top boundary which
 *                                 changes if earlier steps move elements)
 * snapAllConnectionsOrthogonal  — requires: all routes set; provides: strictly orthogonal waypoints
 *                                 (final snap pass; must run after all routing to fix residual diagonals)
 * bundleParallelFlows           — requires: simplified routes; provides: offset parallel same-pair flows
 *                                 (E4: must run after simplification to avoid redundant H-V-H merges;
 *                                 before final orthogonal snap so offsets are preserved correctly)
 * ```
 *
 * B1-5: The sub-steps are now declared in `REPAIR_SIMPLIFY_SUBSTEPS` (see below).
 * The `repairAndSimplifyEdges` PipelineStep in `POST_ROUTING_STEPS` runs them
 * via a nested `PipelineRunner` that shares `ctx.log` for per-sub-step logging.
 */

/**
 * B1-5: Sub-steps of the edge repair pipeline.
 *
 * Order is **B4-critical** — see the dependency chain comment on
 * `repairAndSimplifyEdges` for why each step must follow the previous one.
 * These are declared as a separate `PipelineStep[]` so that:
 *  - The ordering constraint is visible at declaration site.
 *  - `PipelineRunner` can individually log each sub-step via `ctx.log`.
 *  - The `pipeline-ordering.test.ts` (B1-8) can assert the sub-step order.
 */
const REPAIR_SIMPLIFY_SUBSTEPS: PipelineStep[] = [
  {
    name: 'fixDisconnectedEdges',
    run: (ctx) => fixDisconnectedEdges(ctx.elementRegistry, ctx.modeling),
  },
  {
    // D1-3: Replace centre-snap with CroppingConnectionDocking for accurate
    // shape-boundary endpoints (circles for events, diamonds for gateways).
    // Falls back to snapEndpointsToElementCentres when connectionDocking is null.
    name: 'croppingDockPass',
    run: (ctx) => croppingDockPass(ctx.elementRegistry, ctx.modeling, ctx.connectionDocking),
  },
  {
    name: 'rebuildOffRowGatewayRoutes',
    run: (ctx) => rebuildOffRowGatewayRoutes(ctx.elementRegistry, ctx.modeling),
  },
  {
    name: 'separateOverlappingGatewayFlows',
    run: (ctx) => separateOverlappingGatewayFlows(ctx.elementRegistry, ctx.modeling),
  },
  {
    name: 'simplifyCollinearWaypoints',
    run: (ctx) => simplifyCollinearWaypoints(ctx.elementRegistry, ctx.modeling),
  },
  {
    name: 'removeMicroBends',
    run: (ctx) => removeMicroBends(ctx.elementRegistry, ctx.modeling),
  },
  {
    name: 'routeLoopbacksBelow',
    run: (ctx) => routeLoopbacksBelow(ctx.elementRegistry, ctx.modeling),
  },
  {
    // E4: bundle parallel flows before final orthogonal snap
    name: 'bundleParallelFlows',
    run: (ctx) => bundleParallelFlows(ctx.elementRegistry, ctx.modeling),
  },
  {
    name: 'snapAllConnectionsOrthogonal',
    run: (ctx) => snapAllConnectionsOrthogonal(ctx.elementRegistry, ctx.modeling),
  },
];

/**
 * B1-4a: Node-positioning steps (steps 2–8 in the pipeline).
 *
 * These steps operate on element x/y coordinates before edge routes exist.
 * They must run in the listed order (see B2/B3/B5 dependency comments on
 * each step function above).
 *
 * Skip guards are expressed as `skip` predicates for declarative readability.
 */
const NODE_POSITION_STEPS: PipelineStep[] = [
  {
    name: 'applyNodePositions',
    run: (ctx) => applyNodePositions(ctx),
    trackDelta: true,
  },
  {
    name: 'fixBoundaryEvents',
    run: (ctx) => fixBoundaryEvents(ctx),
    trackDelta: true,
  },
  {
    name: 'snapAndAlignLayers',
    run: (ctx) => snapAndAlignLayers(ctx),
    trackDelta: true,
  },
  {
    name: 'gridSnapAndResolveOverlaps',
    run: (ctx) => gridSnapAndResolveOverlaps(ctx),
    trackDelta: true,
  },
  {
    // B1-6: repositionArtifacts takes (elementRegistry, modeling) directly;
    // wrapped here so every step uniformly receives LayoutContext.
    name: 'repositionArtifacts',
    run: (ctx) => repositionArtifacts(ctx.elementRegistry, ctx.modeling),
  },
  {
    name: 'alignHappyPathAndOffPathEvents',
    run: (ctx) => alignHappyPathAndOffPathEvents(ctx),
    trackDelta: true,
  },
  {
    // B5: second resolveOverlaps pass — fixes overlaps created by
    // alignHappyPath pulling multiple elements to the same Y.
    name: 'resolveOverlaps-2nd',
    run: (ctx) => {
      forEachScope(ctx.elementRegistry, (scope) => {
        resolveOverlaps(ctx.elementRegistry, ctx.modeling, scope);
      });
    },
  },
  {
    // G3: Position event subprocesses AFTER all alignment passes so that
    // the main-flow bottom boundary used to anchor them is stable.
    // Moving this from applyNodePositions (step 2) to here (step 8) prevents
    // large vertical gaps and negative-coordinate placement that arise when
    // subsequent passes (gridSnap, alignHappyPath) shift the main flow after
    // the event subprocess has already been positioned relative to it.
    name: 'positionEventSubprocesses',
    run: (ctx) => positionEventSubprocesses(ctx.elementRegistry, ctx.modeling),
  },
];

/**
 * B1-4b: Pool/boundary/edge-routing transition steps (steps 9–12).
 *
 * These bridge node positioning (B1-4a) and post-routing repair (B1-4c).
 * normaliseOrigin runs AFTER applyEdgeRoutes so the origin shift carries
 * both element positions and their freshly-placed waypoints together.
 */
const POOL_BOUNDARY_EDGE_STEPS: PipelineStep[] = [
  {
    name: 'finalisePoolsAndLanes',
    run: (ctx) => finalisePoolsAndLanes(ctx),
  },
  {
    name: 'finaliseBoundaryTargets',
    run: (ctx) => finaliseBoundaryTargets(ctx),
    trackDelta: true,
  },
  {
    // B7: third resolveOverlaps pass — finaliseBoundaryTargets can shift
    // boundary-event target tasks, potentially overlapping adjacent elements.
    // Run before applyEdgeRoutes so edge waypoints are placed against stable
    // element positions.
    name: 'resolveOverlaps-3rd',
    run: (ctx) => {
      forEachScope(ctx.elementRegistry, (scope) => {
        resolveOverlaps(ctx.elementRegistry, ctx.modeling, scope);
      });
    },
  },
  {
    name: 'applyEdgeRoutes',
    run: (ctx) => applyEdgeRoutes(ctx),
  },
  {
    // B1-6: normaliseOrigin takes (elementRegistry, modeling) directly; wrapped
    // here so every step uniformly receives LayoutContext.
    name: 'normaliseOrigin',
    run: (ctx) => normaliseOrigin(ctx.elementRegistry, ctx.modeling),
  },
];

/**
 * B1-4c: Post-routing steps (steps 13–18 in the pipeline).
 *
 * These run after all edge routes have been placed.  The nested sub-runner
 * inside `repairAndSimplifyEdges` preserves the B4 sub-step dependency chain.
 * `detectCrossingFlows` writes its result to `ctx.crossingFlowsResult` so
 * that `elkLayout()` can read it after the pipeline finishes.
 */
const POST_ROUTING_STEPS: PipelineStep[] = [
  {
    // B1-5: sub-steps run via a nested PipelineRunner that shares ctx.log
    name: 'repairAndSimplifyEdges',
    run: (ctx) => {
      const subRunner = new PipelineRunner(REPAIR_SIMPLIFY_SUBSTEPS, ctx.log);
      return subRunner.run(ctx);
    },
  },
  {
    // B1-6: clampFlowsToLaneBounds takes (elementRegistry, modeling) directly.
    name: 'clampFlowsToLaneBounds',
    run: (ctx) => clampFlowsToLaneBounds(ctx.elementRegistry, ctx.modeling),
  },
  {
    // B1-6: routeCrossLaneStaircase takes (elementRegistry, modeling) directly.
    name: 'routeCrossLaneStaircase',
    run: (ctx) => routeCrossLaneStaircase(ctx.elementRegistry, ctx.modeling),
  },
  {
    name: 'reduceCrossings-1st',
    run: (ctx) => reduceCrossings(ctx.elementRegistry, ctx.modeling),
  },
  {
    name: 'avoidElementIntersections',
    run: (ctx) => avoidElementIntersections(ctx.elementRegistry, ctx.modeling),
  },
  {
    // B6: second reduceCrossings — avoidance detours may introduce new crossings.
    name: 'reduceCrossings-2nd',
    run: (ctx) => reduceCrossings(ctx.elementRegistry, ctx.modeling),
  },
  {
    // B6a: final avoidance pass — the 2nd reduceCrossings can nudge waypoints
    // back through element bounding boxes that the 1st avoidance pass had
    // already cleared.  This lightweight pass re-applies avoidance so that
    // the diagram is free of element intersections before detectCrossingFlows.
    name: 'avoidElementIntersections-2nd',
    run: (ctx) => avoidElementIntersections(ctx.elementRegistry, ctx.modeling),
  },
  {
    // Read-only final step: writes result to ctx for return value extraction.
    name: 'detectCrossingFlows',
    run: (ctx) => {
      ctx.crossingFlowsResult = detectCrossingFlows(ctx.elementRegistry);
    },
  },
];

/** All main-pipeline steps in execution order (for ordering tests / B1-8). */
export const MAIN_PIPELINE_STEPS: readonly PipelineStep[] = [
  ...NODE_POSITION_STEPS,
  ...POOL_BOUNDARY_EDGE_STEPS,
  ...POST_ROUTING_STEPS,
];

/** Sub-steps of the edge repair phase (for ordering tests / B1-8). */
export const REPAIR_SIMPLIFY_PIPELINE_STEPS: readonly PipelineStep[] = REPAIR_SIMPLIFY_SUBSTEPS;

// ── Main layout ─────────────────────────────────────────────────────────────

/**
 * Run ELK layered layout on a BPMN diagram.
 *
 * Uses the Sugiyama layered algorithm (via elkjs) to produce clean
 * left-to-right layouts with proper handling of parallel branches,
 * reconverging gateways, and nested containers.
 *
 * ## Pipeline step dependency order
 *
 * The pipeline steps below have strict ordering dependencies.  Reordering
 * them without understanding the dependencies will break layout quality.
 *
 * ```
 * [ELK graph + layout]
 *   → applyNodePositions        — requires: ELK result; provides: element x/y
 *   → fixBoundaryEvents         — requires: element x/y (from ELK); provides: BE x/y
 *   → snapAndAlignLayers        — requires: element x/y; provides: row-snapped y
 *   → gridSnapAndResolveOverlaps — requires: row-snapped y; provides: grid-aligned x/y
 *   → repositionArtifacts       — requires: flow-element x/y; provides: artifact x/y
 *   → alignHappyPathAndOffPathEvents — requires: grid-aligned x/y; provides: happy-path row
 *   → resolveOverlaps (2nd)     — requires: happy-path row; resolves overlaps from alignment
 *   → finalisePoolsAndLanes     — requires: all element x/y; provides: pool/lane bounds
 *   → finaliseBoundaryTargets   — requires: pool/lane bounds + happy-path row; provides: BE target x/y
 *   → applyEdgeRoutes           — requires: FINAL element x/y (after normaliseOrigin);
 *                                  provides: waypoints
 *                                  ⚠ normaliseOrigin runs inside this step, BEFORE edge routes
 *                                    are applied, so that element shifts carry waypoints with them
 *   → repairAndSimplifyEdges    — requires: waypoints; provides: clean orthogonal routes
 *   → clampFlowsToLaneBounds    — requires: lane bounds + waypoints; provides: clamped waypoints
 *   → routeCrossLaneStaircase   — requires: lane bounds + waypoints
 *   → reduceCrossings           — requires: waypoints
 *   → avoidElementIntersections — requires: element x/y + waypoints
 *   → reduceCrossings (2nd)     — avoidance detours may introduce new crossings
 *   → detectCrossingFlows       — read-only; produces return value
 * ```
 *
 * ## Key invariants
 * - `saveBoundaryEventData` must be called BEFORE `applyElkPositions` because
 *   `modeling.moveElements` on host elements drags boundary events.
 * - `normaliseOrigin` must run AFTER `finalisePoolsAndLanes` and BEFORE
 *   `applyElkEdgeRoutes` so that the origin shift is applied to both element
 *   positions and their waypoints atomically.
 * - Edge repair (`repairAndSimplifyEdges`) must run AFTER edge routes are set.
 * - `reduceCrossings` runs twice intentionally: once after repair and once
 *   after `avoidElementIntersections`, because avoidance may introduce crossings.
 *
 * ## Step list (for update commentary)
 * 1. Build ELK graph → run ELK layout
 * 2. Apply node positions + resize compound nodes
 * 3. Fix boundary events
 * 4. Snap/align same-layer elements
 * 5. Grid snap + resolve overlaps
 * 6. Reposition artifacts
 * 7. Align happy path + off-path end events
 * 8. Resolve overlaps (2nd pass — after happy-path alignment)
 * 9. Finalise pools, lanes, collapsed pools
 * 10. Finalise boundary targets + off-path alignment
 * 11. Apply edge routes (self-loops, ELK sections, channel routing) + normalise origin
 * 12. Repair + simplify edges
 * 13. Clamp lane flows + cross-lane staircase routing
 * 14. Reduce crossings (1st pass)
 * 15. Avoid element intersections
 * 16. Reduce crossings (2nd pass)
 * 17. Detect crossing flows (return value)
 */
export async function elkLayout(
  diagram: DiagramState,
  options?: ElkLayoutOptions
): Promise<{ crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> }> {
  // Dynamic import — elkjs is externalized in esbuild
  const ELK = (await import('elkjs')).default;
  const elk = new ELK();

  const log = createLayoutLogger('elkLayout');

  const rawElementRegistry = diagram.modeler.get('elementRegistry') as ElementRegistry;
  // H4: Wrap with CachedElementRegistry to avoid repeated O(n) getAll() array
  // allocations across the 20+ pipeline steps.  The element set does not change
  // during layout (elements are moved but not added/removed), so caching getAll()
  // once at layout start is safe.  invalidate() is called after applyNodePositions
  // because positionEventSubprocesses could move event subprocesses into a
  // configuration where the cache is still valid (no elements are added).
  const elementRegistry: ElementRegistry = new CachedElementRegistry(rawElementRegistry);
  const modeling = diagram.modeler.get('modeling');
  const canvas = diagram.modeler.get('canvas');

  // D1-3: Get CroppingConnectionDocking service for accurate shape-boundary endpoints.
  let connectionDocking: { getCroppedWaypoints: (conn: any) => any[] } | null = null;
  try {
    connectionDocking = diagram.modeler.get('connectionDocking') as typeof connectionDocking;
  } catch {
    // Service not available — croppingDockPass will fall back to snapEndpointsToElementCentres
  }

  // Determine the layout root: scoped to a specific element, or the whole diagram
  const rootElement = resolveRootElement(elementRegistry, canvas, options);

  const allElements: BpmnElement[] = elementRegistry.getAll();
  log.note('init', `${allElements.length} elements, scope=${options?.scopeElementId ?? 'root'}`);

  // Check if we have event subprocesses that will be excluded and repositioned
  const hasEventSubprocesses = allElements.some(
    (el) =>
      el.parent === rootElement &&
      el.type === 'bpmn:SubProcess' &&
      el.businessObject?.triggeredByEvent === true
  );

  // Identify boundary exception chains — excluded from ELK graph to prevent
  // proxy edges from creating extra layers that distort horizontal spacing
  // and cause boundary flows to cross through unrelated elements.
  const boundaryLeafTargetIds = identifyBoundaryExceptionChains(allElements, rootElement);

  const { children, edges, hasDiverseY } = buildContainerGraph(
    allElements,
    rootElement,
    boundaryLeafTargetIds
  );

  if (children.length === 0) return {};

  const { layoutOptions, effectiveLayerSpacing } = resolveLayoutOptions(options);

  if (hasDiverseY && !hasEventSubprocesses) {
    layoutOptions['elk.layered.crossingMinimization.forceNodeModelOrder'] = 'true';
    // A2: For imported DI layouts, also enable NODES_AND_EDGES model-order
    // consideration to better preserve authoring intent across re-layouts.
    // This reduces layout churn when MCP adds elements to an imported diagram
    // incrementally: ELK respects the existing relative order of both nodes
    // and edges, producing smaller positional deltas than pure optimisation.
    layoutOptions['elk.layered.considerModelOrder.strategy'] = 'NODES_AND_EDGES';
    log.note('init', 'hasDiverseY=true — forceNodeModelOrder + NODES_AND_EDGES enabled');
  }

  const happyPathEdgeIds = tagHappyPathEdges(allElements, edges, options);
  log.note(
    'init',
    `ELK graph: ${children.length} nodes, ${edges.length} edges, happyPath=${happyPathEdgeIds?.size ?? 0} edges`
  );

  log.beginStep('elk.layout');
  const result = await elk.layout({
    id: 'root',
    layoutOptions,
    children,
    edges,
  });
  log.endStep();

  const { offsetX, offsetY } = computeLayoutOffset(elementRegistry, options);

  // Build pipeline context
  const snap = () => snapshotPositions(elementRegistry);
  const countMoved = (before: PositionSnapshot) => countMovedElements(elementRegistry, before);

  const ctx: LayoutContext = {
    elementRegistry,
    modeling,
    connectionDocking,
    result,
    offsetX,
    offsetY,
    options,
    happyPathEdgeIds,
    effectiveLayerSpacing,
    hasDiverseY,
    boundaryLeafTargetIds,
    laneSnapshots: saveLaneNodeAssignments(elementRegistry),
    boundarySnapshots: saveBoundaryEventData(elementRegistry),
    log, // B1-6: logger carried in context so sub-pipelines (B1-5) can share it
  };

  // Execute layout pipeline via PipelineRunner (B1-3/B1-4a/4b/4c).
  // Step arrays are declared at module level (NODE_POSITION_STEPS, etc.) for
  // testability (B1-8) and grouped by concern (node positioning, pool/boundary,
  // post-routing).
  const runner = new PipelineRunner(
    [...NODE_POSITION_STEPS, ...POOL_BOUNDARY_EDGE_STEPS, ...POST_ROUTING_STEPS],
    log,
    { snap, count: countMoved }
  );
  await runner.run(ctx);

  const crossingFlowsResult = ctx.crossingFlowsResult ?? { count: 0, pairs: [] };
  log.note('result', `crossingFlows=${crossingFlowsResult.count}`);
  log.finish();
  return {
    crossingFlows: crossingFlowsResult.count,
    crossingFlowPairs: crossingFlowsResult.pairs,
  };
}

/**
 * Resolve the layout root element: scoped to a specific element, or the
 * whole diagram canvas root.
 *
 * ⚠ Limitation (C7 — scoped layout edge boundary): when scoping to a single
 * participant via `scopeElementId`, message flows whose waypoints cross the
 * scope boundary are NOT updated.  The ELK graph only contains nodes and edges
 * inside the scoped participant, so ELK never sees message flows, and the
 * post-layout edge repair passes also skip them.  If scoped re-layout shifts
 * the participant's elements significantly, message flow waypoints will appear
 * disconnected from their new source/target positions.
 *
 * Workaround: run a full layout (without `scopeElementId`) after heavy edits
 * to a collaboration, or manually re-route message flows via
 * `set_bpmn_connection_waypoints`.
 */
function resolveRootElement(
  elementRegistry: ElementRegistry,
  canvas: Canvas,
  options?: ElkLayoutOptions
): BpmnElement {
  if (options?.scopeElementId) {
    const scopeEl = elementRegistry.get(options.scopeElementId);
    if (!scopeEl) {
      throw new Error(`Scope element not found: ${options.scopeElementId}`);
    }
    if (scopeEl.type !== 'bpmn:Participant' && scopeEl.type !== 'bpmn:SubProcess') {
      throw new Error(`Scope element must be a Participant or SubProcess, got: ${scopeEl.type}`);
    }
    return scopeEl;
  }
  return canvas.getRootElement();
}

/**
 * Detect and tag happy-path edges with high straightness priority so ELK
 * keeps them in a single row.  Returns the set of happy-path edge IDs,
 * or undefined if happy-path preservation is disabled.
 */
function tagHappyPathEdges(
  allElements: BpmnElement[],
  edges: ElkExtendedEdge[],
  options?: ElkLayoutOptions
): Set<string> | undefined {
  if (options?.preserveHappyPath === false) return undefined;

  const happyPathEdgeIds = detectHappyPath(allElements);
  if (happyPathEdgeIds.size > 0) {
    for (const edge of edges) {
      if (happyPathEdgeIds.has(edge.id)) {
        edge.layoutOptions = {
          'elk.priority.straightness': ELK_HIGH_PRIORITY,
          'elk.priority.direction': ELK_HIGH_PRIORITY,
        };
      }
    }
  }
  return happyPathEdgeIds;
}

/**
 * Compute the position offset for applying ELK results back to the diagram.
 * For scoped layout, uses the scope element's position; otherwise uses
 * the global origin offset.
 */
function computeLayoutOffset(
  elementRegistry: ElementRegistry,
  options?: ElkLayoutOptions
): { offsetX: number; offsetY: number } {
  if (options?.scopeElementId) {
    const scopeEl = elementRegistry.get(options.scopeElementId);
    return { offsetX: scopeEl?.x ?? ORIGIN_OFFSET_X, offsetY: scopeEl?.y ?? ORIGIN_OFFSET_Y };
  }
  return { offsetX: ORIGIN_OFFSET_X, offsetY: ORIGIN_OFFSET_Y };
}
