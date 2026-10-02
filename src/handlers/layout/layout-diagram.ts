/**
 * Handler for layout_diagram tool.
 *
 * Delegates layout to the `bpmn-auto-layout` library (see src/auto-layout.ts)
 * and applies the generated DI to the modeler as a single undoable command.
 *
 * Supports whole-diagram layout, scoped layout of one participant or
 * subprocess, layout of an arbitrary element subset, pinned element
 * skipping, pre/post-processing (DI repair, grid snap, pool autosize,
 * labels), and dry-run previews.
 */
// @mutating

import { type ToolResult, type ToolContext, type DiagramState } from '../../types';
import { requireDiagram, jsonResult, syncXml, getVisibleElements, getService } from '../helpers';
import { appendLintFeedback, resetMutationCounter } from '../../linter';
import { adjustDiagramLabels, centerFlowLabels } from './labels/adjust-labels';
import { autoLayoutDiagram } from '../../auto-layout';
import {
  applyPixelGridSnap,
  checkDiIntegrity,
  deduplicateDiInModeler,
  alignCollapsedPoolsAfterAutosize,
  computeDisplacementStats,
  repairMissingDiShapes,
} from './layout-helpers';
import { handleAutosizePoolsAndLanes } from '../collaboration/autosize-pools-and-lanes';
import { expandCollapsedSubprocesses } from './expand-subprocesses';
import {
  generateDiagramId,
  storeDiagram,
  deleteDiagram,
  createModelerFromXml,
} from '../../diagram-manager';
import {
  computeLayoutQualityMetrics,
  detectContainerSizingIssues,
  type ContainerSizingIssue,
} from './layout-quality-metrics';
import { computeLaneCrossingMetrics } from './lane-crossing-metrics';

// ── Tolerance (px) for detecting stale association waypoints after layout ──
const ASSOCIATION_WAYPOINT_TOLERANCE = 20;

/** Check whether a point is within element bounds (+ tolerance). */
function pointInBounds(
  pt: { x: number; y: number },
  el: { x: number; y: number; width?: number; height?: number },
  tolerance: number
): boolean {
  const w = el.width || 0;
  const h = el.height || 0;
  return (
    pt.x >= el.x - tolerance &&
    pt.x <= el.x + w + tolerance &&
    pt.y >= el.y - tolerance &&
    pt.y <= el.y + h + tolerance
  );
}

/** Compute a straight 2-point association path using nearest facing edge midpoints. */
function computeAssocWaypoints(
  src: { x: number; y: number; width?: number; height?: number },
  tgt: { x: number; y: number; width?: number; height?: number }
): [{ x: number; y: number }, { x: number; y: number }] {
  const srcCx = src.x + (src.width || 0) / 2;
  const srcCy = src.y + (src.height || 0) / 2;
  const tgtCx = tgt.x + (tgt.width || 0) / 2;
  const tgtCy = tgt.y + (tgt.height || 0) / 2;
  const dx = Math.abs(tgtCx - srcCx);
  const dy = Math.abs(tgtCy - srcCy);
  if (dx >= dy) {
    // Horizontal-dominant: left/right edges
    return tgtCx >= srcCx
      ? [
          { x: Math.round(src.x + (src.width || 0)), y: Math.round(srcCy) },
          { x: Math.round(tgt.x), y: Math.round(tgtCy) },
        ]
      : [
          { x: Math.round(src.x), y: Math.round(srcCy) },
          { x: Math.round(tgt.x + (tgt.width || 0)), y: Math.round(tgtCy) },
        ];
  }
  // Vertical-dominant: top/bottom edges
  return tgtCy >= srcCy
    ? [
        { x: Math.round(srcCx), y: Math.round(src.y + (src.height || 0)) },
        { x: Math.round(tgtCx), y: Math.round(tgt.y) },
      ]
    : [
        { x: Math.round(srcCx), y: Math.round(src.y) },
        { x: Math.round(tgtCx), y: Math.round(tgt.y + (tgt.height || 0)) },
      ];
}

/**
 * Recompute stale association waypoints after element repositioning.
 *
 * `modeling.layoutConnection()` explicitly skips `bpmn:Association`, so
 * association waypoints created at connection-time remain at their original
 * coordinates even after layout repositions connected elements.
 *
 * For each `bpmn:Association` whose first waypoint is outside the source
 * element bounds (+ tolerance) or whose last waypoint is outside the target
 * element bounds (+ tolerance), this function replaces the waypoints with a
 * clean 2-point path: source-element edge midpoint → target-element edge
 * midpoint (nearest facing edges).
 *
 * @returns Object with count of updated associations and their IDs.
 */
function recomputeStaleAssociationWaypoints(
  elementRegistry: any,
  modeling: any
): { count: number; fixedIds: string[] } {
  const tolerance = ASSOCIATION_WAYPOINT_TOLERANCE;
  const allElements: any[] = elementRegistry.getAll();
  const associations = allElements.filter(
    (el: any) => el.type === 'bpmn:Association' && el.source && el.target && el.waypoints?.length
  );

  let count = 0;
  const fixedIds: string[] = [];
  for (const assoc of associations) {
    const src = assoc.source;
    const tgt = assoc.target;
    const wps: Array<{ x: number; y: number }> = assoc.waypoints;
    if (
      pointInBounds(wps[0], src, tolerance) &&
      pointInBounds(wps[wps.length - 1], tgt, tolerance)
    ) {
      continue;
    }
    const [p1, p2] = computeAssocWaypoints(src, tgt);
    try {
      modeling.updateWaypoints(assoc, [p1, p2]);
      count++;
      fixedIds.push(assoc.id as string);
    } catch {
      // Non-fatal: association may not support updateWaypoints in all configs
    }
  }
  return { count, fixedIds };
}

export interface LayoutDiagramArgs {
  diagramId: string;
  /** Optional ID of a Participant or SubProcess to layout in isolation. */
  scopeElementId?: string;
  /**
   * Optional list of sibling flow element IDs to layout in isolation.
   * The subset is laid out on its own and keeps its current top-left corner;
   * connections to the rest of the diagram are re-routed.
   */
  elementIds?: string[];
  /** Pixel grid snap: snap element positions to the nearest multiple of this value. */
  gridSnap?: number;
  /** When true, preview layout changes without applying them. */
  dryRun?: boolean;
  /**
   * Automatically resize pools and lanes after layout to fit all elements
   * with proper padding. Default: auto-enabled when the diagram contains pools.
   */
  poolExpansion?: boolean;
  /**
   * When true, expand collapsed subprocesses that have internal flow-node
   * children before running layout.
   * Default: false (preserve existing collapsed/expanded state).
   */
  expandSubprocesses?: boolean;
  /**
   * When true, only adjust labels without performing full layout.
   * Useful for fixing label overlaps without changing element positions.
   */
  labelsOnly?: boolean;
  /**
   * When true, only resize pools and lanes to fit their contents without running full layout.
   * Equivalent to the former autosize_bpmn_pools_and_lanes tool.
   * Accepts participantId to scope resizing to a single pool.
   */
  autosizeOnly?: boolean;
  /** When autosizeOnly is true, scope pool resizing to this participant ID. */
  participantId?: string;
  /**
   * When true, include full diagnostics: the non-orthogonal flow ID list,
   * per-pool/lane sizing issues, cross-lane crossing flow IDs, and the
   * recomputed association ID list. Default: false — the response stays a
   * compact summary with only actionable warnings and up to two nextSteps.
   */
  verbose?: boolean;
}

/** Handle labels-only mode: just adjust labels without full layout. */
async function handleLabelsOnlyMode(diagramId: string): Promise<ToolResult> {
  const diagram = requireDiagram(diagramId);
  const flowLabelsCentered = await centerFlowLabels(diagram);
  const elementLabelsMoved = await adjustDiagramLabels(diagram);
  const totalMoved = flowLabelsCentered + elementLabelsMoved;

  return jsonResult({
    success: true,
    flowLabelsCentered,
    elementLabelsMoved,
    totalMoved,
    message:
      totalMoved > 0
        ? `Adjusted ${totalMoved} label(s) to reduce overlap (${elementLabelsMoved} element labels, ${flowLabelsCentered} flow labels centered)`
        : 'No label adjustments needed \u2014 all labels are well-positioned',
  });
}

/** Perform a dry-run layout: clone → layout → diff → discard clone. */
async function handleDryRunLayout(args: LayoutDiagramArgs): Promise<ToolResult> {
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);
  const { xml } = await diagram.modeler.saveXML({ format: true });

  const tempId = generateDiagramId();
  const modeler = await createModelerFromXml(xml || '');
  storeDiagram(tempId, { modeler, xml: xml || '', name: `_dryrun_${diagramId}` });

  try {
    const tempDiagram: DiagramState = { modeler, xml: xml || '' };
    const tempRegistry = getService(tempDiagram.modeler, 'elementRegistry');

    // Capture original positions
    const originalPositions = new Map<string, { x: number; y: number }>();
    for (const el of getVisibleElements(tempRegistry)) {
      if (el.x !== undefined && el.y !== undefined) {
        originalPositions.set(el.id, { x: el.x, y: el.y });
      }
    }

    // Run auto-layout on the clone
    const pixelGridSnap = typeof args.gridSnap === 'number' ? args.gridSnap : undefined;
    await autoLayoutDiagram(tempDiagram, {
      scopeElementId: args.scopeElementId,
      elementIds: args.elementIds,
    });

    if (pixelGridSnap && pixelGridSnap > 0) applyPixelGridSnap(tempDiagram, pixelGridSnap);

    const stats = computeDisplacementStats(originalPositions, tempRegistry);
    const qualityMetrics = computeLayoutQualityMetrics(tempRegistry);
    const totalElements = getVisibleElements(tempRegistry).filter(
      (el: any) =>
        !el.type.includes('SequenceFlow') &&
        !el.type.includes('MessageFlow') &&
        !el.type.includes('Association')
    ).length;

    const isLargeChange = stats.movedCount > totalElements * 0.5 && stats.maxDisplacement > 200;

    return jsonResult({
      success: true,
      dryRun: true,
      totalElements,
      movedCount: stats.movedCount,
      maxDisplacement: stats.maxDisplacement,
      avgDisplacement: stats.avgDisplacement,
      qualityMetrics,
      ...(isLargeChange
        ? {
            warning: `Layout would move ${stats.movedCount}/${totalElements} elements with max displacement of ${stats.maxDisplacement}px.`,
          }
        : {}),
      topDisplacements: stats.displacements,
      message: `Dry run: layout would move ${stats.movedCount}/${totalElements} elements (max ${stats.maxDisplacement}px, avg ${stats.avgDisplacement}px). Call without dryRun to apply.`,
    });
  } finally {
    deleteDiagram(tempId);
  }
}

/**
 * Build the nextSteps array with lane and sizing advice.
 *
 * By default (verbose: false) the array is capped to at most 2 entries —
 * the always-present export reminder plus the single most relevant
 * situational hint. Pass verbose: true for the full, uncapped list.
 */
function buildNextSteps(
  laneCrossingMetrics: ReturnType<typeof computeLaneCrossingMetrics>,
  sizingIssues: ContainerSizingIssue[],
  poolExpansionApplied?: boolean,
  verbose?: boolean
): Array<{ tool: string; description: string }> {
  const steps: Array<{ tool: string; description: string }> = [
    {
      tool: 'export_bpmn',
      description:
        'Diagram layout is complete. Use export_bpmn with format and filePath to save the diagram.',
    },
  ];

  if (laneCrossingMetrics && laneCrossingMetrics.laneCoherenceScore < 70) {
    // Suppress redistribution advice when most crossings originate from
    // gateway fan-out — those cross-lane flows are structurally required
    // and lane reordering cannot eliminate them.
    const gw = laneCrossingMetrics.gatewaySourcedCrossings ?? 0;
    const crossings = laneCrossingMetrics.crossingLaneFlows;
    const mostlyGateway = crossings > 0 && gw / crossings >= 0.8;

    if (mostlyGateway) {
      steps.push({
        tool: 'analyze_bpmn_lanes',
        description:
          `Lane coherence score is ${laneCrossingMetrics.laneCoherenceScore}% — ` +
          `but ${gw}/${crossings} crossing flow(s) originate from gateway fan-out, which is ` +
          `structurally necessary and cannot be reduced by lane reordering. ` +
          `No redistribution is recommended.`,
      });
    } else {
      steps.push({
        tool: 'analyze_bpmn_lanes',
        description: `Lane coherence score is ${laneCrossingMetrics.laneCoherenceScore}% (below 70%). Run analyze_bpmn_lanes with mode: 'validate' for detailed lane improvement suggestions.`,
      });
      steps.push({
        tool: 'create_bpmn_lanes',
        description: `Lane coherence is low (${laneCrossingMetrics.laneCoherenceScore}%). Run create_bpmn_lanes with strategy: 'minimize-crossings' and validate: true to automatically minimize cross-lane flows.`,
      });
    }
  }

  const poolIssues = sizingIssues.filter((i) => i.severity === 'warning');
  if (poolIssues.length > 0 && !poolExpansionApplied) {
    steps.push({
      tool: 'layout_bpmn_diagram',
      description:
        `${poolIssues.length} pool(s) need resizing: ` +
        poolIssues
          .map((i) => `${i.containerName} → ${i.recommendedWidth}×${i.recommendedHeight}px`)
          .join(', ') +
        '. Run layout_bpmn_diagram with autosizeOnly: true to fix automatically, or use move_bpmn_element with width/height for manual control.',
    });
  }

  return verbose ? steps : steps.slice(0, 2);
}

/**
 * Resize pools/lanes after layout when explicitly requested.
 * The layout library already sizes pools and lanes to fit their contents,
 * so this only runs with `poolExpansion: true`.
 */
async function autosizePools(
  args: LayoutDiagramArgs,
  diagram: DiagramState,
  elementRegistry: any
): Promise<boolean> {
  if (args.poolExpansion !== true) return false;

  const poolResult = await handleAutosizePoolsAndLanes({ diagramId: args.diagramId });
  const poolData = JSON.parse(poolResult.content[0].text as string);
  const applied = (poolData.resizedCount ?? 0) > 0;
  if (applied) {
    const modeling = getService(diagram.modeler, 'modeling');
    alignCollapsedPoolsAfterAutosize(elementRegistry, modeling);
  }
  return applied;
}

/**
 * Build the association stale-waypoint block for the layout response.
 * By default only the count is included; verbose adds the ID list and a
 * detailed warning explaining how to fix a bad recomputed path.
 */
function buildAssocWaypointsBlock(
  associationWaypointsFixed: number | undefined,
  fixedAssociationIds: string[] | undefined,
  verbose?: boolean
): Record<string, unknown> {
  if (!associationWaypointsFixed || associationWaypointsFixed === 0) return {};
  if (!verbose) return { associationWaypointsFixed };
  return {
    associationWaypointsFixed,
    ...(fixedAssociationIds && fixedAssociationIds.length > 0 ? { fixedAssociationIds } : {}),
    associationWarning:
      `${associationWaypointsFixed} association(s) had stale waypoints that were recomputed: ` +
      `[${(fixedAssociationIds ?? []).join(', ')}]. ` +
      `Verify association paths are visually correct; if not, use connect_bpmn_elements ` +
      `with explicit waypoints to route them manually.`,
  };
}

/**
 * Build the laneCrossingMetrics block for the layout response.
 * By default omits the per-flow crossingFlowIds list; verbose includes it.
 */
function buildLaneCrossingBlock(
  laneCrossingMetrics: ReturnType<typeof computeLaneCrossingMetrics>,
  verbose?: boolean
): Record<string, unknown> {
  if (!laneCrossingMetrics) return {};
  return {
    laneCrossingMetrics: {
      totalLaneFlows: laneCrossingMetrics.totalLaneFlows,
      crossingLaneFlows: laneCrossingMetrics.crossingLaneFlows,
      laneCoherenceScore: laneCrossingMetrics.laneCoherenceScore,
      ...(verbose && laneCrossingMetrics.crossingFlowIds
        ? { crossingFlowIds: laneCrossingMetrics.crossingFlowIds }
        : {}),
    },
  };
}

/**
 * Compact quality metrics for the default response: drops the
 * nonOrthogonalFlowIds list, which can be large and is only actionable
 * together with the full nextSteps/lint detail available via verbose.
 */
function compactQualityMetrics(
  qualityMetrics: ReturnType<typeof computeLayoutQualityMetrics>,
  verbose?: boolean
): ReturnType<typeof computeLayoutQualityMetrics> {
  if (verbose) return qualityMetrics;
  const { orthogonalFlowPercent, avgBendCount } = qualityMetrics;
  return { orthogonalFlowPercent, avgBendCount };
}

/** Apply association waypoint recomputation after layout and return layout-response props. */
function fixStaleAssocWaypoints(diagram: any): {
  assocCount: number;
  assocIds: string[];
} {
  const modelingService = getService(diagram.modeler, 'modeling');
  const registryService = getService(diagram.modeler, 'elementRegistry');
  const fix = recomputeStaleAssociationWaypoints(registryService, modelingService);
  return { assocCount: fix.count, assocIds: fix.fixedIds };
}

/** Build the final JSON response for a layout result. */
function buildLayoutResponse(opts: {
  diagramId: string;
  scopeElementId?: string;
  elementIds?: string[];
  elementCount: number;
  result: { repositionedCount: number; reroutedCount: number };
  laneCrossingMetrics: ReturnType<typeof computeLaneCrossingMetrics>;
  sizingIssues: ContainerSizingIssue[];
  qualityMetrics: ReturnType<typeof computeLayoutQualityMetrics>;
  diWarnings: string[];
  poolExpansionApplied: boolean;
  subprocessesExpanded: number;
  layoutWarnings: string[];
  associationWaypointsFixed?: number;
  fixedAssociationIds?: string[];
  verbose?: boolean;
}): ToolResult {
  const {
    diagramId,
    scopeElementId,
    elementIds,
    elementCount,
    result,
    laneCrossingMetrics,
    sizingIssues,
    qualityMetrics,
    diWarnings,
    poolExpansionApplied,
    subprocessesExpanded,
    layoutWarnings,
    associationWaypointsFixed,
    fixedAssociationIds,
    verbose,
  } = opts;

  const scopeNote =
    scopeElementId || elementIds?.length
      ? 'Connections crossing the layout boundary were re-routed with a default path, and the laid-out part may now overlap neighbouring elements. Run a full layout (without scopeElementId/elementIds) if the result looks crowded.'
      : undefined;

  return jsonResult({
    success: true,
    elementCount,
    repositionedCount: result.repositionedCount,
    reroutedCount: result.reroutedCount,
    ...buildAssocWaypointsBlock(associationWaypointsFixed, fixedAssociationIds, verbose),
    ...(layoutWarnings.length > 0 ? { layoutWarnings } : {}),
    ...buildLaneCrossingBlock(laneCrossingMetrics, verbose),
    ...(verbose && sizingIssues.length > 0 ? { containerSizingIssues: sizingIssues } : {}),
    qualityMetrics: compactQualityMetrics(qualityMetrics, verbose),
    message:
      `Auto-layout applied to diagram ${diagramId}` +
      `${scopeElementId ? ` (scoped to ${scopeElementId})` : ''}` +
      `${elementIds?.length ? ` (limited to ${elementIds.length} element(s))` : ''}` +
      ` — ${elementCount} elements arranged, ${result.repositionedCount} repositioned, ${result.reroutedCount} connections re-routed`,
    ...(scopeNote ? { scopeNote } : {}),
    ...(diWarnings.length > 0 ? { diWarnings } : {}),
    ...(poolExpansionApplied ? { poolExpansionApplied: true } : {}),
    ...(subprocessesExpanded > 0 ? { subprocessesExpanded } : {}),
    nextSteps: buildNextSteps(laneCrossingMetrics, sizingIssues, poolExpansionApplied, verbose),
  });
}

/** Count non-connection visible elements. */
function countFlowElements(elementRegistry: any): number {
  return getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association')
  ).length;
}

/** Validate the scopeElementId argument — throws if invalid. */
function validateScopeElement(diagram: any, scopeElementId: string): void {
  const registry = getService(diagram.modeler, 'elementRegistry');
  const scopeEl = registry.get(scopeElementId);
  if (!scopeEl) {
    throw new Error(`Scope element '${scopeElementId}' not found in diagram`);
  }
  const t = scopeEl.type;
  if (t !== 'bpmn:Participant' && t !== 'bpmn:SubProcess' && t !== 'bpmn:Process') {
    throw new Error(
      `scopeElementId must reference a Participant, SubProcess, or Process, got '${t}'`
    );
  }
}

/** Validate the elementIds argument — throws if invalid. */
function validateElementIds(diagram: any, args: LayoutDiagramArgs): void {
  if (!args.elementIds?.length) return;
  if (args.scopeElementId) {
    throw new Error('Pass either scopeElementId or elementIds, not both');
  }
  const registry = getService(diagram.modeler, 'elementRegistry');
  const missing = args.elementIds.filter((id) => !registry.get(id));
  if (missing.length > 0) {
    throw new Error(`Elements not found in diagram: ${missing.join(', ')}`);
  }
}

export async function handleLayoutDiagram(
  args: LayoutDiagramArgs,
  context?: ToolContext
): Promise<ToolResult> {
  if (args.autosizeOnly) {
    // Delegate to autosize handler, passing optional participantId
    const autosizeArgs: any = { diagramId: args.diagramId };
    if (args.participantId) autosizeArgs.participantId = args.participantId;
    const result = await handleAutosizePoolsAndLanes(autosizeArgs);
    const data = JSON.parse(result.content[0].text as string);
    return jsonResult({ ...data, autosizeOnly: true });
  }
  if (args.labelsOnly) return handleLabelsOnlyMode(args.diagramId);

  const { diagramId, scopeElementId, elementIds } = args;
  const diagram = requireDiagram(diagramId);
  validateElementIds(diagram, args);
  if (scopeElementId) validateScopeElement(diagram, scopeElementId);

  if (args.dryRun) return handleDryRunLayout(args);

  const progress = context?.sendProgress;

  await progress?.(0, 100, 'Preparing layout…');
  const subprocessesExpanded = args.expandSubprocesses ? expandCollapsedSubprocesses(diagram) : 0;
  const preRepairs = repairMissingDiShapes(diagram);

  await progress?.(10, 100, 'Running auto-layout…');
  const isPartial = !!scopeElementId || !!elementIds?.length;
  const result = await autoLayoutDiagram(diagram, {
    scopeElementId,
    elementIds,
    pinnedElementIds: diagram.pinnedElements,
  });

  await progress?.(60, 100, 'Post-processing layout…');
  const pixelGridSnap = typeof args.gridSnap === 'number' ? args.gridSnap : undefined;
  if (pixelGridSnap) applyPixelGridSnap(diagram, pixelGridSnap);
  deduplicateDiInModeler(diagram);

  // Re-run repairMissingDiShapes after layout to recover any DI shapes
  // that may have been lost or invalidated by element repositioning.
  const postRepairs = repairMissingDiShapes(diagram);
  const allRepairs = [...preRepairs, ...postRepairs];

  if (!isPartial) {
    diagram.pinnedElements = undefined;
    diagram.pinnedConnections = undefined;
  }

  // Safety net for associations whose waypoints were not produced by the
  // layout library (e.g. outside the laid-out subset).
  const { assocCount, assocIds } = fixStaleAssocWaypoints(diagram);
  result.reroutedCount += assocCount;

  await syncXml(diagram);
  resetMutationCounter(diagram);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  await progress?.(85, 100, 'Resizing pools…');
  const poolExpansionApplied = await autosizePools(args, diagram, elementRegistry);

  const finalQualityMetrics = computeLayoutQualityMetrics(elementRegistry);

  const layoutResult = buildLayoutResponse({
    diagramId,
    scopeElementId,
    elementIds,
    elementCount: countFlowElements(elementRegistry),
    result,
    laneCrossingMetrics: computeLaneCrossingMetrics(elementRegistry),
    sizingIssues: detectContainerSizingIssues(elementRegistry),
    qualityMetrics: finalQualityMetrics,
    diWarnings: [...allRepairs, ...checkDiIntegrity(diagram, elementRegistry)],
    poolExpansionApplied,
    subprocessesExpanded,
    layoutWarnings: result.warnings.map((w) => w.message),
    associationWaypointsFixed: assocCount,
    fixedAssociationIds: assocIds,
    verbose: args.verbose,
  });

  return appendLintFeedback(layoutResult, diagram);
}

// Schema extracted to layout-diagram-schema.ts for readability.
export { TOOL_DEFINITION } from './layout-diagram-schema';
