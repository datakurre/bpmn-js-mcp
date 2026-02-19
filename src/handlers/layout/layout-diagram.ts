/**
 * Handler for layout_diagram tool.
 *
 * Uses elkjs (Eclipse Layout Kernel) with the Sugiyama layered algorithm
 * to produce clean left-to-right layouts.  Handles parallel branches,
 * reconverging gateways, and nested containers better than the previous
 * bpmn-auto-layout approach.
 *
 * Supports partial re-layout via `elementIds` — only the specified
 * elements and their inter-connections are arranged.
 */
// @mutating

import { type ToolResult, type ToolContext } from '../../types';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  getVisibleElements,
  getService,
  isCollaboration,
} from '../helpers';
import { appendLintFeedback, resetMutationCounter } from '../../linter';
import { adjustDiagramLabels, adjustFlowLabels, centerFlowLabels } from './labels/adjust-labels';
import { elkLayout, elkLayoutSubset, applyDeterministicLayout } from '../../elk/api';
import {
  applyPixelGridSnap,
  checkDiIntegrity,
  buildLayoutResult,
  repairMissingDiShapes,
  deduplicateDiInModeler,
  alignCollapsedPoolsAfterAutosize,
} from './layout-helpers';
import { handleDryRunLayout } from './layout-dryrun';
import { handleAutosizePoolsAndLanes } from '../collaboration/autosize-pools-and-lanes';
import { expandCollapsedSubprocesses } from './expand-subprocesses';

export interface LayoutDiagramArgs {
  diagramId: string;
  direction?: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
  nodeSpacing?: number;
  layerSpacing?: number;
  scopeElementId?: string;
  preserveHappyPath?: boolean;
  compactness?: 'compact' | 'spacious';
  simplifyRoutes?: boolean;
  /** Optional list of element IDs for partial re-layout. */
  elementIds?: string[];
  /** Grid snap: boolean to enable/disable ELK grid snap, or number for pixel-level snapping. */
  gridSnap?: boolean | number;
  /** When true, preview layout changes without applying them. */
  dryRun?: boolean;
  /**
   * Layout algorithm strategy:
   * - 'full': full ELK Sugiyama layered layout (default)
   * - 'deterministic': simplified layout for trivial diagrams (linear chains, single split-merge);
   *   falls back to 'full' if the diagram is too complex
   */
  layoutStrategy?: 'full' | 'deterministic';
  /**
   * Lane layout strategy:
   * - 'preserve': keep elements in their current lanes (default)
   * - 'optimize': reorder lanes to minimize cross-lane flows
   */
  laneStrategy?: 'preserve' | 'optimize';
  /**
   * Automatically resize pools and lanes after layout to fit all elements
   * with proper padding. Prevents the common problem of elements overflowing
   * pool/lane boundaries after layout repositioning.
   * Default: auto-enabled when the diagram contains pools.
   * Set to false to explicitly disable.
   */
  poolExpansion?: boolean;
  /**
   * When true, expand collapsed subprocesses that have internal flow-node
   * children before running layout.  This converts drill-down plane
   * subprocesses to inline expanded subprocesses so ELK can lay out their
   * children on the main plane.
   * Default: false (preserve existing collapsed/expanded state).
   */
  expandSubprocesses?: boolean;
  /**
   * When true, only adjust labels without performing full layout.
   * Useful for fixing label overlaps without changing element positions.
   */
  labelsOnly?: boolean;
  /**
   * When true, only resize pools and lanes to fit their elements.
   * No ELK layout is performed. Equivalent to the former autosize_bpmn_pools_and_lanes tool.
   */
  autosizeOnly?: boolean;
}

/** Run the appropriate layout algorithm based on strategy and args. */
async function executeLayout(
  diagram: any,
  args: LayoutDiagramArgs
): Promise<{
  layoutResult: { crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> };
  usedDeterministic: boolean;
}> {
  const {
    direction,
    nodeSpacing,
    layerSpacing,
    scopeElementId,
    preserveHappyPath,
    compactness,
    simplifyRoutes,
    layoutStrategy,
    elementIds,
  } = args;
  const rawGridSnap = args.gridSnap;
  const elkGridSnap = typeof rawGridSnap === 'boolean' ? rawGridSnap : undefined;

  // Deterministic layout for trivial diagrams (linear chains, single split-merge)
  if (layoutStrategy === 'deterministic' && !elementIds && !scopeElementId) {
    if (applyDeterministicLayout(diagram)) {
      return { layoutResult: {}, usedDeterministic: true };
    }
    // Fall back to full ELK layout if diagram is not trivial
  }

  if (elementIds && elementIds.length > 0) {
    const result = await elkLayoutSubset(diagram, elementIds, {
      direction,
      nodeSpacing,
      layerSpacing,
    });
    return { layoutResult: result, usedDeterministic: false };
  }

  const result = await elkLayout(diagram, {
    direction,
    nodeSpacing,
    layerSpacing,
    scopeElementId,
    preserveHappyPath,
    gridSnap: elkGridSnap,
    compactness,
    simplifyRoutes,
    laneStrategy: args.laneStrategy,
  });
  return { layoutResult: result, usedDeterministic: false };
}

/** Handle labels-only mode: just adjust labels without full layout. */
async function handleLabelsOnlyMode(diagramId: string): Promise<ToolResult> {
  const {
    adjustDiagramLabels: adjDiag,
    adjustFlowLabels: adjFlow,
    centerFlowLabels: ctrFlow,
  } = await import('./labels/adjust-labels');
  const diagram = requireDiagram(diagramId);
  const flowLabelsCentered = await ctrFlow(diagram);
  const elementLabelsMoved = await adjDiag(diagram);
  const flowLabelsMoved = await adjFlow(diagram);
  const totalMoved = flowLabelsCentered + elementLabelsMoved + flowLabelsMoved;
  return jsonResult({
    success: true,
    flowLabelsCentered,
    elementLabelsMoved,
    flowLabelsMoved,
    totalMoved,
    message:
      totalMoved > 0
        ? `Adjusted ${totalMoved} label(s) to reduce overlap (${elementLabelsMoved} element, ${flowLabelsMoved} flow)`
        : 'No label adjustments needed \u2014 all labels are well-positioned',
  });
}

/** Post-layout processing: pixel snap, DI cleanup, labels, pool autosize. */
async function postProcessLayout(
  diagram: any,
  args: LayoutDiagramArgs,
  context?: ToolContext
): Promise<{
  elements: any[];
  labelsMoved: number;
  poolExpansionApplied: boolean;
  diWarnings: string[];
  repairs: string[];
}> {
  const { diagramId, scopeElementId } = args;
  const { elementIds } = args;
  const pixelGridSnap = typeof args.gridSnap === 'number' ? args.gridSnap : undefined;
  const progress = context?.sendProgress;

  await progress?.(60, 100, 'Post-processing layout…');

  if (pixelGridSnap && pixelGridSnap > 0) applyPixelGridSnap(diagram, pixelGridSnap);
  deduplicateDiInModeler(diagram);

  if (!elementIds && !scopeElementId) {
    diagram.pinnedElements = undefined;
    diagram.pinnedConnections = undefined;
  }

  await syncXml(diagram);
  resetMutationCounter(diagram);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const elements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association')
  );

  await progress?.(70, 100, 'Adjusting labels…');
  await centerFlowLabels(diagram);
  const elLabelsMoved = await adjustDiagramLabels(diagram);
  const flowLabelsMoved = await adjustFlowLabels(diagram);

  await progress?.(85, 100, 'Resizing pools…');
  let poolExpansionApplied = false;
  const shouldAutosize =
    args.poolExpansion === true ||
    (args.poolExpansion === undefined && isCollaboration(elementRegistry));
  if (shouldAutosize) {
    const poolResult = await handleAutosizePoolsAndLanes({ diagramId });
    const poolData = JSON.parse(poolResult.content[0].text as string);
    poolExpansionApplied = (poolData.resizedCount ?? 0) > 0;
    alignCollapsedPoolsAfterAutosize(elementRegistry, getService(diagram.modeler, 'modeling'));
  }

  const diWarnings = checkDiIntegrity(diagram, elementRegistry);

  return {
    elements,
    labelsMoved: elLabelsMoved + flowLabelsMoved,
    poolExpansionApplied,
    diWarnings,
    repairs: [],
  };
}

/** Save waypoints for all pinned connections so they can be restored after layout. */
function savePinnedConnectionWaypoints(diagram: any): Map<string, Array<{ x: number; y: number }>> {
  const saved = new Map<string, Array<{ x: number; y: number }>>();
  if (!diagram.pinnedConnections?.size) return saved;
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  for (const connId of diagram.pinnedConnections) {
    const conn = elementRegistry.get(connId);
    if (conn?.waypoints) {
      saved.set(
        connId,
        conn.waypoints.map((wp: any) => ({ x: wp.x, y: wp.y }))
      );
    }
  }
  return saved;
}

/** Restore previously saved pinned connection waypoints after layout. */
function restorePinnedConnectionWaypoints(
  diagram: any,
  saved: Map<string, Array<{ x: number; y: number }>>
): void {
  if (saved.size === 0) return;
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  for (const [connId, waypoints] of saved) {
    const conn = elementRegistry.get(connId);
    if (conn && waypoints.length >= 2) {
      try {
        modeling.updateWaypoints(conn, waypoints);
      } catch {
        // Skip connections that can't be restored (e.g. element was deleted)
      }
    }
  }
}

export async function handleLayoutDiagram(
  args: LayoutDiagramArgs,
  context?: ToolContext
): Promise<ToolResult> {
  if (args.labelsOnly) return handleLabelsOnlyMode(args.diagramId);
  if (args.autosizeOnly) return handleAutosizePoolsAndLanes({ diagramId: args.diagramId });

  if (args.dryRun) return handleDryRunLayout(args);

  const { diagramId, scopeElementId } = args;
  let { elementIds } = args;
  const diagram = requireDiagram(diagramId);
  const progress = context?.sendProgress;

  await progress?.(0, 100, 'Preparing layout…');

  // For partial layout, filter out pinned elements
  const pinnedSkipped: string[] = [];
  if (elementIds && elementIds.length > 0 && diagram.pinnedElements?.size) {
    const filtered = elementIds.filter((id) => !diagram.pinnedElements!.has(id));
    if (filtered.length < elementIds.length) {
      pinnedSkipped.push(...elementIds.filter((id) => diagram.pinnedElements!.has(id)));
      elementIds = filtered;
    }
  }

  // Build layout args with potentially filtered elementIds
  const layoutArgs: LayoutDiagramArgs =
    elementIds !== args.elementIds ? { ...args, elementIds } : args;

  // Optionally expand collapsed subprocesses before layout
  let subprocessesExpanded = 0;
  if (args.expandSubprocesses) {
    subprocessesExpanded = expandCollapsedSubprocesses(diagram);
  }

  // Repair missing DI shapes before layout so ELK can position all elements
  const repairs = await repairMissingDiShapes(diagram);

  // Save pinned connection waypoints before layout so they can be restored
  // after the pipeline overwrites them. Mirroring element pinning, full
  // layout (no elementIds / scopeElementId) clears the pin state so future
  // layouts are free to re-route the connection.
  const savedPinnedWaypoints = savePinnedConnectionWaypoints(diagram);

  await progress?.(10, 100, 'Running ELK layout…');
  const { layoutResult, usedDeterministic } = await executeLayout(diagram, layoutArgs);

  // Restore pinned connection waypoints after the layout pipeline
  restorePinnedConnectionWaypoints(diagram, savedPinnedWaypoints);

  const postResult = await postProcessLayout(diagram, layoutArgs, context);
  const allDiWarnings = [...repairs, ...postResult.diWarnings];

  const result = buildLayoutResult({
    diagramId,
    scopeElementId,
    elementIds,
    elementCount: elementIds ? elementIds.length : postResult.elements.length,
    labelsMoved: postResult.labelsMoved,
    layoutResult,
    elementRegistry: getService(diagram.modeler, 'elementRegistry'),
    usedDeterministic,
    diWarnings: allDiWarnings,
    poolExpansionApplied: postResult.poolExpansionApplied,
    pinnedSkipped,
    subprocessesExpanded,
  });
  return appendLintFeedback(result, diagram);
}

/** Snap collapsed pools to match expanded pool horizontal extent after autosize. */
// Schema extracted to layout-diagram-schema.ts for readability.
export { TOOL_DEFINITION } from './layout-diagram-schema';
