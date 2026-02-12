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
import type { BpmnElement, ElementRegistry, Modeling, Canvas } from '../bpmn-types';
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

// ── Layout pipeline context ─────────────────────────────────────────────────

/** Shared context threaded through the layout pipeline steps. */
interface LayoutContext {
  elementRegistry: ElementRegistry;
  modeling: Modeling;
  result: ElkNode;
  offsetX: number;
  offsetY: number;
  options: ElkLayoutOptions | undefined;
  happyPathEdgeIds: Set<string> | undefined;
  effectiveLayerSpacing: number | undefined;
  hasDiverseY: boolean;
  boundaryLeafTargetIds: Set<string>;
  laneSnapshots: ReturnType<typeof saveLaneNodeAssignments>;
  boundarySnapshots: ReturnType<typeof saveBoundaryEventData>;
}

// ── Pipeline step functions ─────────────────────────────────────────────────

/** Apply ELK-computed node positions and resize compound nodes. */
function applyNodePositions(ctx: LayoutContext): void {
  applyElkPositions(ctx.elementRegistry, ctx.modeling, ctx.result, ctx.offsetX, ctx.offsetY);
  resizeCompoundNodes(ctx.elementRegistry, ctx.modeling, ctx.result);
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
 */
function gridSnapAndResolveOverlaps(ctx: LayoutContext): void {
  const shouldGridSnap = ctx.options?.gridSnap !== false;
  if (!shouldGridSnap) return;

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
  });

  // Resolve overlaps created by grid quantisation
  forEachScope(ctx.elementRegistry, (scope) => {
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

  forEachScope(ctx.elementRegistry, (scope) => {
    alignHappyPath(ctx.elementRegistry, ctx.modeling, ctx.happyPathEdgeIds, scope, ctx.hasDiverseY);
  });

  forEachScope(ctx.elementRegistry, (scope) => {
    alignOffPathEndEvents(ctx.elementRegistry, ctx.modeling, ctx.happyPathEdgeIds, scope);
  });
}

/**
 * Centre elements in pools, reposition lanes, and reorder collapsed
 * pools below expanded pools.
 */
function finalisePoolsAndLanes(ctx: LayoutContext): void {
  centreElementsInPools(ctx.elementRegistry, ctx.modeling);
  repositionLanes(ctx.elementRegistry, ctx.modeling, ctx.laneSnapshots);
  reorderCollapsedPoolsBelow(ctx.elementRegistry, ctx.modeling);
}

/**
 * Final boundary event restore/reposition, then position boundary-only
 * leaf targets and align off-path end events to the boundary target row.
 */
function finaliseBoundaryTargets(ctx: LayoutContext): void {
  // Re-restore after snap/grid passes may have moved host tasks
  restoreBoundaryEventData(ctx.elementRegistry, ctx.boundarySnapshots);
  repositionBoundaryEvents(ctx.elementRegistry, ctx.modeling, ctx.boundarySnapshots);

  repositionBoundaryEventTargets(ctx.elementRegistry, ctx.modeling, ctx.boundaryLeafTargetIds);

  alignOffPathEndEventsToSecondRow(
    ctx.elementRegistry,
    ctx.modeling,
    ctx.boundaryLeafTargetIds,
    ctx.happyPathEdgeIds
  );
}

/**
 * Apply ELK edge routes, simplify gateway branch routes, and route
 * branch connections through inter-column channels.
 */
function applyEdgeRoutes(ctx: LayoutContext): void {
  applyElkEdgeRoutes(ctx.elementRegistry, ctx.modeling, ctx.result, ctx.offsetX, ctx.offsetY);

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
 * Repair disconnected edge endpoints, snap to element centres,
 * rebuild off-row gateway routes, simplify collinear waypoints,
 * and final orthogonal snap.
 */
function repairAndSimplifyEdges(ctx: LayoutContext): void {
  fixDisconnectedEdges(ctx.elementRegistry, ctx.modeling);
  snapEndpointsToElementCentres(ctx.elementRegistry, ctx.modeling);
  rebuildOffRowGatewayRoutes(ctx.elementRegistry, ctx.modeling);
  simplifyCollinearWaypoints(ctx.elementRegistry, ctx.modeling);
  snapAllConnectionsOrthogonal(ctx.elementRegistry, ctx.modeling);
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
 * 1. Build ELK graph → run ELK layout
 * 2. Apply node positions + resize compound nodes
 * 3. Fix boundary events
 * 4. Snap/align same-layer elements
 * 5. Grid snap + resolve overlaps
 * 6. Reposition artifacts
 * 7. Align happy path + off-path end events
 * 8. Finalise pools, lanes, collapsed pools
 * 9. Finalise boundary targets + off-path alignment
 * 10. Apply edge routes + channel routing
 * 11. Repair + simplify edges
 * 12. Detect crossing flows
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
  const rootElement = resolveRootElement(elementRegistry, canvas, options);

  const allElements: BpmnElement[] = elementRegistry.getAll();

  // Identify boundary-only leaf targets — excluded from ELK graph to prevent
  // proxy edges from creating extra layers that distort horizontal spacing.
  const boundaryLeafTargetIds = identifyBoundaryLeafTargets(allElements, rootElement);

  const { children, edges, hasDiverseY } = buildContainerGraph(
    allElements,
    rootElement,
    boundaryLeafTargetIds
  );

  if (children.length === 0) return {};

  const { layoutOptions, effectiveLayerSpacing } = resolveLayoutOptions(options);

  if (hasDiverseY) {
    layoutOptions['elk.layered.crossingMinimization.forceNodeModelOrder'] = 'true';
  }

  const happyPathEdgeIds = tagHappyPathEdges(allElements, edges, options);

  const result = await elk.layout({
    id: 'root',
    layoutOptions,
    children,
    edges,
  });

  const { offsetX, offsetY } = computeLayoutOffset(elementRegistry, options);

  // Build pipeline context
  const ctx: LayoutContext = {
    elementRegistry,
    modeling,
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
  };

  // Execute layout pipeline
  applyNodePositions(ctx);
  fixBoundaryEvents(ctx);
  snapAndAlignLayers(ctx);
  gridSnapAndResolveOverlaps(ctx);
  repositionArtifacts(elementRegistry, modeling);
  alignHappyPathAndOffPathEvents(ctx);
  finalisePoolsAndLanes(ctx);
  finaliseBoundaryTargets(ctx);
  applyEdgeRoutes(ctx);
  repairAndSimplifyEdges(ctx);

  const crossingFlowsResult = detectCrossingFlows(elementRegistry);
  return {
    crossingFlows: crossingFlowsResult.count,
    crossingFlowPairs: crossingFlowsResult.pairs,
  };
}

/**
 * Resolve the layout root element: scoped to a specific element, or the
 * whole diagram canvas root.
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
