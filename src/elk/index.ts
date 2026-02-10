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
 * 6. Reposition artifacts → repositionArtifacts()
 * 7. Apply ELK edge sections as waypoints → applyElkEdgeRoutes()
 * 7.5. Route branch connections through inter-column channels → routeBranchConnectionsThroughChannels()
 * 8. Repair disconnected edge endpoints → fixDisconnectedEdges()
 * 9. Final orthogonal snap → snapAllConnectionsOrthogonal()
 * 10. Detect crossing flows → detectCrossingFlows()
 */

import type { DiagramState } from '../types';
import type { ElkNode, ElkExtendedEdge, LayoutOptions } from 'elkjs';

import { isConnection, isInfrastructure, isArtifact } from './helpers';
import { ELK_LAYOUT_OPTIONS, ORIGIN_OFFSET_X, ORIGIN_OFFSET_Y } from './constants';
import { buildContainerGraph } from './graph-builder';
import { applyElkPositions, resizeCompoundNodes } from './position-application';
import {
  repositionBoundaryEvents,
  saveBoundaryEventData,
  restoreBoundaryEventData,
} from './boundary-events';
import { snapSameLayerElements, snapAllConnectionsOrthogonal } from './snap-alignment';
import { applyElkEdgeRoutes, fixDisconnectedEdges } from './edge-routing';
import { repositionArtifacts } from './artifacts';
import { routeBranchConnectionsThroughChannels } from './channel-routing';
import { detectHappyPath } from './happy-path';
import { gridSnapPass, gridSnapExpandedSubprocesses } from './grid-snap';
import { detectCrossingFlows } from './crossing-detection';
import type { ElkLayoutOptions } from './types';

export type { ElkLayoutOptions, CrossingFlowsResult, GridLayer } from './types';

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
  let rootElement: any;
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

  const allElements: any[] = elementRegistry.getAll();
  const { children, edges } = buildContainerGraph(allElements, rootElement);

  if (children.length === 0) return {};

  // Merge user-provided options with defaults
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

  // Happy-path emphasis: prioritise the default/first-connected branch as the
  // straight-through flow by fixing its layer-sweep priority.  ELK's
  // LAYER_SWEEP crossing minimization can be guided via port constraints
  // and model order — we use thoroughness to get better results.
  layoutOptions['elk.layered.crossingMinimization.thoroughness'] = '30';
  // Use model order for node ordering — first-connected branches stay central
  layoutOptions['elk.layered.considerModelOrder.strategy'] = 'NODES_AND_EDGES';

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
            'elk.priority.straightness': '10',
            'elk.priority.direction': '10',
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
  snapSameLayerElements(elementRegistry, modeling);

  // Step 5: Post-ELK grid snap pass — quantises node positions to a
  // virtual grid for visual regularity.  Runs independently within each
  // participant for collaboration diagrams, and recursively for expanded
  // subprocesses.
  const shouldGridSnap = options?.gridSnap !== false;
  if (shouldGridSnap) {
    // For collaborations, run grid snap within each participant
    const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
    if (participants.length > 0) {
      for (const participant of participants) {
        gridSnapPass(elementRegistry, modeling, happyPathEdgeIds, participant);
        // Also run within expanded subprocesses inside this participant
        gridSnapExpandedSubprocesses(elementRegistry, modeling, happyPathEdgeIds, participant);
      }
    } else {
      gridSnapPass(elementRegistry, modeling, happyPathEdgeIds);
      // Also run within expanded subprocesses at the root level
      gridSnapExpandedSubprocesses(elementRegistry, modeling, happyPathEdgeIds);
    }
  }

  // Step 6: Reposition artifacts (data objects, data stores, annotations)
  // outside the main flow — they were excluded from the ELK graph.
  repositionArtifacts(elementRegistry, modeling);

  // Step 6.5: Final boundary event restore + reposition.
  // Snap/grid passes (steps 4-5) may have moved host tasks, which can
  // re-corrupt boundary events in headless mode.  Restore and reposition
  // once more before edge routing.
  restoreBoundaryEventData(elementRegistry, boundarySnapshots);
  repositionBoundaryEvents(elementRegistry, modeling, boundarySnapshots);

  // Step 7: Apply ELK edge routes as waypoints (orthogonal, no diagonals).
  // Uses ELK's own edge sections instead of bpmn-js ManhattanLayout,
  // eliminating diagonals, S-curves, and gateway routing interference.
  applyElkEdgeRoutes(elementRegistry, modeling, result, offsetX, offsetY);

  // Step 7.5: Route gateway branch connections through inter-column channels.
  // Shifts vertical segments to the midpoint between columns rather than
  // hugging the gateway edge, matching bpmn-auto-layout's channel routing.
  if (shouldGridSnap) {
    const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
    if (participants.length > 0) {
      for (const participant of participants) {
        routeBranchConnectionsThroughChannels(elementRegistry, modeling, participant);
      }
    } else {
      routeBranchConnectionsThroughChannels(elementRegistry, modeling);
    }
  }

  // Step 8: Repair disconnected edge endpoints.
  // GridSnap (step 5) may have moved elements after ELK computed edge
  // routes (step 7), leaving waypoints that no longer connect to their
  // source/target elements.  This pass snaps endpoints back.
  fixDisconnectedEdges(elementRegistry, modeling);

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
// eslint-disable-next-line complexity
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
  const shapes: any[] = [];
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
  let sharedContainer: any = null;
  if (shapes.length > 1) {
    const parents = shapes
      .map((s: any) => s.parent)
      .filter((p: any) => p && (p.type === 'bpmn:Participant' || p.type === 'bpmn:SubProcess'));
    if (parents.length === shapes.length) {
      const firstParentId = parents[0].id;
      if (parents.every((p: any) => p.id === firstParentId)) {
        sharedContainer = parents[0];
      }
    }
  }

  // Include artifacts linked to selected elements via associations.
  // These are added as fixed-position nodes so ELK routes around them.
  const allElements: any[] = elementRegistry.getAll();
  const associations = allElements.filter(
    (el: any) =>
      (el.type === 'bpmn:Association' ||
        el.type === 'bpmn:DataInputAssociation' ||
        el.type === 'bpmn:DataOutputAssociation') &&
      el.source &&
      el.target
  );

  const linkedArtifactIds = new Set<string>();
  for (const assoc of associations) {
    if (idSet.has(assoc.source.id) && isArtifact(assoc.target.type)) {
      linkedArtifactIds.add(assoc.target.id);
    }
    if (idSet.has(assoc.target.id) && isArtifact(assoc.source.type)) {
      linkedArtifactIds.add(assoc.source.id);
    }
  }

  // Build ELK children nodes
  const children: ElkNode[] = shapes.map((s: any) => ({
    id: s.id,
    width: s.width || 100,
    height: s.height || 80,
  }));

  // Add linked artifacts as pinned ELK nodes (fixed position) so the
  // layout respects their presence but doesn't move them.
  for (const artId of linkedArtifactIds) {
    if (idSet.has(artId)) continue; // already in the subset
    const art = elementRegistry.get(artId);
    if (!art) continue;
    children.push({
      id: art.id,
      width: art.width || 100,
      height: art.height || 30,
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
    minX = sharedContainer.x + 20;
    minY = sharedContainer.y + 50;
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
