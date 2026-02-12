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
 * 8.3. Snap flow endpoints to element centres → snapEndpointsToElementCentres()
 * 8.5. Simplify collinear waypoints → simplifyCollinearWaypoints()
 * 9. Final orthogonal snap → snapAllConnectionsOrthogonal()
 * 10. Detect crossing flows → detectCrossingFlows()
 */

import type { DiagramState } from '../types';
import type { ElkNode, ElkExtendedEdge, LayoutOptions } from 'elkjs';

import { isConnection, isInfrastructure, isArtifact } from './helpers';
import type { BpmnElement, ElementRegistry } from '../bpmn-types';
import {
  ELK_LAYOUT_OPTIONS,
  ORIGIN_OFFSET_X,
  ORIGIN_OFFSET_Y,
  ELK_HIGH_PRIORITY,
  START_OFFSET_X,
  START_OFFSET_Y,
  BPMN_TASK_WIDTH,
  BPMN_TASK_HEIGHT,
  BPMN_DUMMY_HEIGHT,
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
  centreElementsInPools,
  reorderCollapsedPoolsBelow,
} from './position-application';
import { repositionLanes, saveLaneNodeAssignments } from './lane-layout';
import {
  repositionBoundaryEvents,
  saveBoundaryEventData,
  restoreBoundaryEventData,
  identifyBoundaryLeafTargets,
  repositionBoundaryEventTargets,
  alignOffPathEndEventsToSecondRow,
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
  snapEndpointsToElementCentres,
  rebuildOffRowGatewayRoutes,
} from './edge-routing';
import { repositionArtifacts } from './artifacts';
import { routeBranchConnectionsThroughChannels } from './channel-routing';
import { detectHappyPath } from './happy-path';
import {
  gridSnapPass,
  gridSnapExpandedSubprocesses,
  alignHappyPath,
  alignOffPathEndEvents,
} from './grid-snap';
import { detectCrossingFlows } from './crossing-detection';
import { resolveOverlaps } from './overlap-resolution';
import type { ElkLayoutOptions } from './types';

export type { ElkLayoutOptions, CrossingFlowsResult, GridLayer } from './types';

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  layoutOptions['elk.layered.crossingMinimization.thoroughness'] = '30';
  layoutOptions['elk.layered.considerModelOrder.strategy'] = 'NODES_AND_EDGES';

  return { layoutOptions, effectiveLayerSpacing };
}

// ── Main layout ─────────────────────────────────────────────────────────────

/**
 * Run ELK layered layout on a BPMN diagram.
 *
 * Uses the Sugiyama layered algorithm (via elkjs) to produce clean
 * left-to-right layouts with proper handling of parallel branches,
 * reconverging gateways, and nested containers.
 *
 * Pipeline:
 * 1. Build ELK graph from bpmn-js element registry
 * 2. Run ELK layout (node positions + edge routes)
 * 3. Apply node positions via `modeling.moveElements`
 * 4. Snap same-layer elements to common Y (vertical alignment)
 * 5. Post-ELK grid snap pass (uniform columns + vertical spacing)
 * 6. Apply ELK edge sections as connection waypoints (bypasses
 *    bpmn-js ManhattanLayout entirely for ELK-routed edges)
 * 7. Route branch connections through inter-column channels
 * 8. Repair disconnected edge endpoints after gridSnap moves
 * 8.5. Simplify collinear waypoints (remove redundant bends)
 * 9. Detect crossing flows and report count
 */
export async function elkLayout(
  diagram: DiagramState,
  options?: ElkLayoutOptions
): Promise<{ crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> }> {
  // Dynamic import — elkjs is externalized in esbuild
  const ELK = (await import('elkjs')).default;
  const elk = new ELK();

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const canvas = diagram.modeler.get('canvas');

  // Determine the layout root: scoped to a specific element, or the whole diagram
  let rootElement: BpmnElement;
  if (options?.scopeElementId) {
    const scopeEl = elementRegistry.get(options.scopeElementId);
    if (!scopeEl) {
      throw new Error(`Scope element not found: ${options.scopeElementId}`);
    }
    if (scopeEl.type !== 'bpmn:Participant' && scopeEl.type !== 'bpmn:SubProcess') {
      throw new Error(`Scope element must be a Participant or SubProcess, got: ${scopeEl.type}`);
    }
    rootElement = scopeEl;
  } else {
    rootElement = canvas.getRootElement();
  }

  const allElements: BpmnElement[] = elementRegistry.getAll();

  // Identify boundary-only leaf targets (end events reached only from
  // boundary events).  These are excluded from the ELK graph to prevent
  // proxy edges from creating extra layers that distort horizontal spacing.
  // They are positioned manually after boundary events are placed.
  const boundaryLeafTargetIds = identifyBoundaryLeafTargets(allElements, rootElement);

  const { children, edges, hasDiverseY } = buildContainerGraph(
    allElements,
    rootElement,
    boundaryLeafTargetIds
  );

  if (children.length === 0) return {};

  // Merge user-provided options with defaults
  const { layoutOptions, effectiveLayerSpacing } = resolveLayoutOptions(options);

  // When the imported BPMN has DI coordinates with diverse Y positions,
  // force node model order so crossing minimisation preserves the DI-based
  // Y-position sort applied in graph-builder.ts.  For programmatically
  // created diagrams (all at same Y), let ELK freely optimise.
  if (hasDiverseY) {
    layoutOptions['elk.layered.crossingMinimization.forceNodeModelOrder'] = 'true';
  }

  // When preserveHappyPath is enabled (default: true), detect the main path
  // and tag its edges with high straightness priority so ELK keeps them in
  // a single row.
  const shouldPreserveHappyPath = options?.preserveHappyPath !== false;
  let happyPathEdgeIds: Set<string> | undefined;
  if (shouldPreserveHappyPath) {
    happyPathEdgeIds = detectHappyPath(allElements);
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
  }

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions,
    children,
    edges,
  };

  const result = await elk.layout(elkGraph);

  // For scoped layout, compute the offset from the scope element's position
  let offsetX: number;
  let offsetY: number;
  if (options?.scopeElementId) {
    const scopeEl = elementRegistry.get(options.scopeElementId);
    offsetX = scopeEl.x;
    offsetY = scopeEl.y;
  } else {
    offsetX = ORIGIN_OFFSET_X;
    offsetY = ORIGIN_OFFSET_Y;
  }

  // Save lane → flow-node assignments before any moves — bpmn-js's
  // modeling.moveElements mutates lane.businessObject.flowNodeRef when
  // nodes cross lane boundaries during layout passes.
  const laneSnapshots = saveLaneNodeAssignments(elementRegistry);

  // Save boundary event data before any moves — headless mode can
  // corrupt boundary event types during modeling.moveElements.
  const boundarySnapshots = saveBoundaryEventData(elementRegistry);

  // Step 1: Apply ELK-computed node positions
  applyElkPositions(elementRegistry, modeling, result, offsetX, offsetY);

  // Step 2: Resize compound nodes (participants, expanded subprocesses)
  // to match ELK-computed dimensions.  Must be AFTER applyElkPositions
  // so that x/y are already correct.
  resizeCompoundNodes(elementRegistry, modeling, result);

  // Step 2.5: Restore boundary event types and host references.
  // Must run before snap/grid passes so they correctly exclude boundary
  // events (they filter by type === 'bpmn:BoundaryEvent').
  restoreBoundaryEventData(elementRegistry, boundarySnapshots);

  // Step 3: Fix boundary event positions.  They are excluded from the
  // ELK graph and should follow their host via moveElements, but
  // headless mode may leave them stranded.
  repositionBoundaryEvents(elementRegistry, modeling, boundarySnapshots);

  // Step 4: Snap same-layer elements to common Y (fixes 5–10 px offsets)
  // Scoped per-participant for collaborations, and recursively for
  // expanded subprocesses to avoid cross-nesting-level mixing.
  forEachScope(elementRegistry, (scope) => {
    snapSameLayerElements(elementRegistry, modeling, scope);
    snapExpandedSubprocesses(elementRegistry, modeling, scope);
  });

  // Step 5: Post-ELK grid snap pass — quantises node positions to a
  // virtual grid for visual regularity.  Runs independently within each
  // participant for collaboration diagrams, and recursively for expanded
  // subprocesses.
  const shouldGridSnap = options?.gridSnap !== false;

  if (shouldGridSnap) {
    forEachScope(elementRegistry, (scope) => {
      gridSnapPass(elementRegistry, modeling, happyPathEdgeIds, scope, effectiveLayerSpacing);
      gridSnapExpandedSubprocesses(
        elementRegistry,
        modeling,
        happyPathEdgeIds,
        scope,
        effectiveLayerSpacing
      );
    });
  }

  // Step 6: Reposition artifacts (data objects, data stores, annotations)
  // outside the main flow — they were excluded from the ELK graph.
  repositionArtifacts(elementRegistry, modeling);

  // Step 5.6: Resolve overlaps created by grid snap.
  // Grid quantisation can push elements into overlapping positions.
  // This pass detects overlapping pairs and pushes them apart vertically.
  if (shouldGridSnap) {
    forEachScope(elementRegistry, (scope) => {
      resolveOverlaps(elementRegistry, modeling, scope);
    });
  }

  // Step 5.5: Align happy-path elements to a single Y-centre.
  // GridSnapPass can introduce small Y-centre wobbles (5–15 px) due to
  // ELK's gateway port placement.  This pass snaps all happy-path elements
  // to the median Y-centre for a perfectly straight main flow line.
  // Only applies for horizontal (RIGHT/LEFT) layouts.
  const effectiveDirection = options?.direction || 'RIGHT';
  if (
    shouldPreserveHappyPath &&
    happyPathEdgeIds &&
    happyPathEdgeIds.size > 0 &&
    (effectiveDirection === 'RIGHT' || effectiveDirection === 'LEFT')
  ) {
    forEachScope(elementRegistry, (scope) => {
      alignHappyPath(elementRegistry, modeling, happyPathEdgeIds, scope, hasDiverseY);
    });

    // Step 5.55: Align off-path end events with their predecessor.
    // After happy-path alignment moves happy-path elements (and their
    // column-mates), off-path end events may be stranded at the wrong Y.
    // This pass aligns them to their incoming source element's Y-centre.
    forEachScope(elementRegistry, (scope) => {
      alignOffPathEndEvents(elementRegistry, modeling, happyPathEdgeIds, scope);
    });
  }

  // Step 5.7: Centre elements vertically within participant pools.
  // After grid snap and happy-path alignment, content inside pools may
  // not be vertically centred.  This pass shifts elements to be centred
  // within each pool's usable area.
  centreElementsInPools(elementRegistry, modeling);

  // Step 5.75: Reposition lanes inside participant pools.
  // Lanes are excluded from ELK layout — they are structural containers.
  // After flow nodes are positioned, resize each lane to encompass its
  // assigned flow nodes (from bpmn:Lane.flowNodeRef).
  repositionLanes(elementRegistry, modeling, laneSnapshots);

  // Step 5.8: Ensure collapsed pools are below expanded pools.
  // ELK may place collapsed participants above expanded ones; this pass
  // moves them below the bottommost expanded pool with a consistent gap.
  reorderCollapsedPoolsBelow(elementRegistry, modeling);

  // Step 6.5: Final boundary event restore + reposition.
  // Snap/grid passes (steps 4-5) may have moved host tasks, which can
  // re-corrupt boundary events in headless mode.  Restore and reposition
  // once more before edge routing.
  restoreBoundaryEventData(elementRegistry, boundarySnapshots);
  repositionBoundaryEvents(elementRegistry, modeling, boundarySnapshots);

  // Step 6.6: Reposition boundary-only leaf targets below their hosts.
  // These elements were excluded from the ELK graph and need manual
  // positioning after boundary events are at their final positions.
  repositionBoundaryEventTargets(elementRegistry, modeling, boundaryLeafTargetIds);

  // Step 6.7: Align off-path end events to the boundary target row.
  // Gateway "No" branch end events that sit between the happy path and
  // the boundary target row are pushed down for consistent alignment.
  alignOffPathEndEventsToSecondRow(
    elementRegistry,
    modeling,
    boundaryLeafTargetIds,
    happyPathEdgeIds
  );

  // Step 7: Apply ELK edge routes as waypoints (orthogonal, no diagonals).
  // Uses ELK's own edge sections instead of bpmn-js ManhattanLayout,
  // eliminating diagonals, S-curves, and gateway routing interference.
  applyElkEdgeRoutes(elementRegistry, modeling, result, offsetX, offsetY);

  // Step 7.5: Route gateway branch connections through inter-column channels.
  // Shifts vertical segments to the midpoint between columns rather than
  // hugging the gateway edge, matching bpmn-auto-layout's channel routing.
  if (shouldGridSnap) {
    // Step 7.3: Simplify gateway branch routes to clean L-shapes.
    // For split-gateway → branch-target and branch-target → join-gateway
    // connections, replace multi-bend ELK routes with clean 4-waypoint
    // Z-shaped routes (horizontal → vertical → horizontal).
    // Configurable via options.simplifyRoutes (default: true).
    const shouldSimplifyRoutes = options?.simplifyRoutes !== false;
    if (shouldSimplifyRoutes) {
      simplifyGatewayBranchRoutes(elementRegistry, modeling);
    }

    forEachScope(elementRegistry, (scope) => {
      routeBranchConnectionsThroughChannels(elementRegistry, modeling, scope);
    });
  }

  // Step 8: Repair disconnected edge endpoints.
  // GridSnap (step 5) may have moved elements after ELK computed edge
  // routes (step 7), leaving waypoints that no longer connect to their
  // source/target elements.  This pass snaps endpoints back.
  fixDisconnectedEdges(elementRegistry, modeling);

  // Step 8.3: Snap flow endpoints to element centres.
  // ELK uses port positions that may be offset from element geometric
  // centres, causing subtle Y-wobble on horizontal flows.  This pass
  // adjusts endpoints so they connect at element centre lines.
  snapEndpointsToElementCentres(elementRegistry, modeling);

  // Step 8.4: Rebuild off-row gateway routes.
  // ELK may route gateway branches as flat horizontal lines when it
  // places elements on the same row.  Post-ELK grid snap and happy-path
  // alignment can separate elements vertically, leaving flat routes that
  // should be L-bends.  This pass detects such routes and rebuilds them
  // with proper L-bend routing matching bpmn-js conventions:
  // - Split gateway → off-row target: exit bottom/top of diamond
  // - Off-row source → join gateway: enter bottom/top of diamond
  rebuildOffRowGatewayRoutes(elementRegistry, modeling);

  // Step 8.5: Simplify collinear waypoints.
  // Remove redundant middle points where three consecutive waypoints
  // lie on the same horizontal or vertical line, producing cleaner
  // routes with fewer bend points.
  simplifyCollinearWaypoints(elementRegistry, modeling);

  // Step 9: Final orthogonal snap pass on ALL connections.
  // Catches residual near-diagonal segments from ELK rounding or fallback routing.
  snapAllConnectionsOrthogonal(elementRegistry, modeling);

  // Step 10: Detect crossing sequence flows for diagnostics
  const crossingFlowsResult = detectCrossingFlows(elementRegistry);

  return {
    crossingFlows: crossingFlowsResult.count,
    crossingFlowPairs: crossingFlowsResult.pairs,
  };
}

// ── Partial (subset) layout ────────────────────────────────────────────────

/**
 * Run ELK layered layout on a subset of elements in a BPMN diagram.
 *
 * Builds a sub-graph from the specified element IDs and their
 * inter-connections, runs ELK layout on that sub-graph, and applies
 * positions back — leaving all other elements untouched.
 *
 * Enhancements:
 * - Detects if selected elements share a common participant/subprocess
 *   and uses it as the layout scope (respecting container boundaries).
 * - Includes nearby artifacts (data objects, annotations) linked to
 *   selected elements via associations as pinned (fixed-position) context.
 */

export async function elkLayoutSubset(
  diagram: DiagramState,
  elementIds: string[],
  options?: Omit<ElkLayoutOptions, 'scopeElementId'>
): Promise<{ crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> }> {
  const ELK = (await import('elkjs')).default;
  const elk = new ELK();

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');

  const idSet = new Set(elementIds);

  // Collect shapes from the element registry
  const shapes: BpmnElement[] = [];
  for (const id of elementIds) {
    const el = elementRegistry.get(id);
    if (el && !isConnection(el.type) && !isInfrastructure(el.type)) {
      shapes.push(el);
    }
  }

  if (shapes.length === 0) return {};

  // Detect if all selected elements share a common container (participant
  // or subprocess).  If so, constrain the layout offset to that container's
  // boundaries so elements don't escape their pool.
  let sharedContainer: BpmnElement | null = null;
  if (shapes.length > 1) {
    const parents = shapes
      .map((s) => s.parent)
      .filter(
        (p): p is BpmnElement =>
          !!p && (p.type === 'bpmn:Participant' || p.type === 'bpmn:SubProcess')
      );
    if (parents.length === shapes.length) {
      const firstParentId = parents[0].id;
      if (parents.every((p) => p.id === firstParentId)) {
        sharedContainer = parents[0];
      }
    }
  }

  // Include artifacts linked to selected elements via associations.
  // These are added as fixed-position nodes so ELK routes around them.
  const allElements: BpmnElement[] = elementRegistry.getAll();
  const associations = allElements.filter(
    (el) =>
      (el.type === 'bpmn:Association' ||
        el.type === 'bpmn:DataInputAssociation' ||
        el.type === 'bpmn:DataOutputAssociation') &&
      !!el.source &&
      !!el.target
  );

  const linkedArtifactIds = new Set<string>();
  for (const assoc of associations) {
    if (idSet.has(assoc.source!.id) && isArtifact(assoc.target!.type)) {
      linkedArtifactIds.add(assoc.target!.id);
    }
    if (idSet.has(assoc.target!.id) && isArtifact(assoc.source!.type)) {
      linkedArtifactIds.add(assoc.source!.id);
    }
  }

  // Build ELK children nodes
  const children: ElkNode[] = shapes.map((s) => ({
    id: s.id,
    width: s.width || BPMN_TASK_WIDTH,
    height: s.height || BPMN_TASK_HEIGHT,
  }));

  // Add linked artifacts as pinned ELK nodes (fixed position) so the
  // layout respects their presence but doesn't move them.
  for (const artId of linkedArtifactIds) {
    if (idSet.has(artId)) continue; // already in the subset
    const art = elementRegistry.get(artId);
    if (!art) continue;
    children.push({
      id: art.id,
      width: art.width || BPMN_TASK_WIDTH,
      height: art.height || BPMN_DUMMY_HEIGHT,
      layoutOptions: {
        'elk.position': `(${art.x}, ${art.y})`,
        'org.eclipse.elk.noLayout': 'true',
      },
    });
  }
  const edges: ElkExtendedEdge[] = [];
  for (const el of allElements) {
    if (
      isConnection(el.type) &&
      el.source &&
      el.target &&
      idSet.has(el.source.id) &&
      idSet.has(el.target.id)
    ) {
      edges.push({
        id: el.id,
        sources: [el.source.id],
        targets: [el.target.id],
      });
    }
  }

  // Build ELK layout options
  const layoutOptions: LayoutOptions = { ...ELK_LAYOUT_OPTIONS };
  if (options?.direction) {
    layoutOptions['elk.direction'] = options.direction;
  }
  if (options?.nodeSpacing !== undefined) {
    layoutOptions['elk.spacing.nodeNode'] = String(options.nodeSpacing);
  }
  if (options?.layerSpacing !== undefined) {
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(options.layerSpacing);
  }

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions,
    children,
    edges,
  };

  const result = await elk.layout(elkGraph);

  // Use the container origin as offset when elements share a container,
  // otherwise use the minimum existing position so elements stay roughly
  // in the same area of the canvas.
  let minX = Infinity;
  let minY = Infinity;
  if (sharedContainer) {
    // Offset inside the container with padding
    minX = sharedContainer.x + START_OFFSET_X;
    minY = sharedContainer.y + START_OFFSET_Y;
  } else {
    for (const s of shapes) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
    }
  }
  const offsetX = minX;
  const offsetY = minY;

  // Apply positions
  applyElkPositions(elementRegistry, modeling, result, offsetX, offsetY);

  // Apply edge routes for the subset connections
  applyElkEdgeRoutes(elementRegistry, modeling, result, offsetX, offsetY);

  return {};
}
