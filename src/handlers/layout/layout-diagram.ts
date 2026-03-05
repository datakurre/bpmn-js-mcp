/**
 * Handler for layout_diagram tool.
 *
 * Uses the rebuild-based layout engine that repositions elements using
 * topology-driven placement with bpmn-js native positioning.
 *
 * Supports pinned element skipping, pre/post-processing (DI repair,
 * grid snap, pool autosize, labels), and dry-run previews.
 */
// @mutating

import { type ToolResult, type ToolContext, type DiagramState } from '../../types';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  getVisibleElements,
  getService,
  isCollaboration,
} from '../helpers';
import { appendLintFeedback, resetMutationCounter } from '../../linter';
import { adjustDiagramLabels, centerFlowLabels } from './labels/adjust-labels';
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
import { rebuildLayout, applyAllBackEdgeUShapes } from '../../rebuild';
import { stackPools } from '../../rebuild/container-layout';
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

export interface LayoutDiagramArgs {
  diagramId: string;
  /** Optional ID of a Participant or SubProcess to layout in isolation. */
  scopeElementId?: string;
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

/** Perform a dry-run layout: clone → rebuild → diff → discard clone. */
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

    // Run rebuild layout on the clone (pass gridSnap for forward-pass alignment)
    const pixelGridSnap = typeof args.gridSnap === 'number' ? args.gridSnap : undefined;
    rebuildLayout(tempDiagram, { gridSnap: pixelGridSnap });

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

/** Build the nextSteps array with lane and sizing advice. */
function buildNextSteps(
  laneCrossingMetrics: ReturnType<typeof computeLaneCrossingMetrics>,
  sizingIssues: ContainerSizingIssue[],
  poolExpansionApplied?: boolean,
  qualityMetrics?: ReturnType<typeof computeLayoutQualityMetrics>
): Array<{ tool: string; description: string }> {
  const steps: Array<{ tool: string; description: string }> = [
    {
      tool: 'export_bpmn',
      description:
        'Diagram layout is complete. Use export_bpmn with format and filePath to save the diagram.',
    },
  ];

  if (qualityMetrics) {
    const pct = qualityMetrics.orthogonalFlowPercent;
    if (pct < 90) {
      steps.push({
        tool: 'layout_bpmn_diagram',
        description:
          `Flow orthogonality is ${pct}% (below 90%). Re-run layout_bpmn_diagram to attempt ` +
          `improvement, or run validate_bpmn_diagram to identify specific non-orthogonal segments.`,
      });
    }
  }

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
        tool: 'redistribute_bpmn_elements_across_lanes',
        description: `Lane coherence is low (${laneCrossingMetrics.laneCoherenceScore}%). Run redistribute_bpmn_elements_across_lanes with validate: true to automatically minimize cross-lane flows.`,
      });
    }
  }

  const poolIssues = sizingIssues.filter((i) => i.severity === 'warning');
  if (poolIssues.length > 0 && !poolExpansionApplied) {
    steps.push({
      tool: 'autosize_bpmn_pools_and_lanes',
      description:
        `${poolIssues.length} pool(s) need resizing: ` +
        poolIssues
          .map((i) => `${i.containerName} → ${i.recommendedWidth}×${i.recommendedHeight}px`)
          .join(', ') +
        '. Run autosize_bpmn_pools_and_lanes to fix automatically, or use move_bpmn_element with width/height for manual control.',
    });
  }

  return steps;
}

/** Run labels adjustment (center flow labels + adjust element labels). */
async function adjustAllLabels(diagram: DiagramState): Promise<number> {
  const flowLabelsCentered = await centerFlowLabels(diagram);
  const elLabelsMoved = await adjustDiagramLabels(diagram);
  return flowLabelsCentered + elLabelsMoved;
}

/** Auto-resize pools/lanes if needed, returns whether resizing was applied. */
async function autosizePools(
  args: LayoutDiagramArgs,
  diagram: DiagramState,
  elementRegistry: any
): Promise<boolean> {
  const shouldAutosize =
    args.poolExpansion === true ||
    (args.poolExpansion === undefined && isCollaboration(elementRegistry));
  if (!shouldAutosize) return false;

  const poolResult = await handleAutosizePoolsAndLanes({ diagramId: args.diagramId });
  const poolData = JSON.parse(poolResult.content[0].text as string);
  const applied = (poolData.resizedCount ?? 0) > 0;
  if (applied) {
    const modeling = getService(diagram.modeler, 'modeling');
    alignCollapsedPoolsAfterAutosize(elementRegistry, modeling);
    // Re-stack pools to fix gaps after height changes from autosizing
    const pools = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
    if (pools.length >= 2) stackPools(pools, modeling, 30);
  }
  return applied;
}

/** Build the final JSON response for a layout result. */
function buildLayoutResponse(opts: {
  diagramId: string;
  scopeElementId?: string;
  elementCount: number;
  labelsMoved: number;
  result: { repositionedCount: number; reroutedCount: number };
  laneCrossingMetrics: ReturnType<typeof computeLaneCrossingMetrics>;
  sizingIssues: ContainerSizingIssue[];
  qualityMetrics: ReturnType<typeof computeLayoutQualityMetrics>;
  diWarnings: string[];
  poolExpansionApplied: boolean;
  subprocessesExpanded: number;
  boundaryEventWarning?: string;
}): ToolResult {
  const {
    diagramId,
    scopeElementId,
    elementCount,
    labelsMoved,
    result,
    laneCrossingMetrics,
    sizingIssues,
    qualityMetrics,
    diWarnings,
    poolExpansionApplied,
    subprocessesExpanded,
    boundaryEventWarning,
  } = opts;

  const scopeNote = scopeElementId
    ? 'Message flows crossing the scope boundary were not re-routed. Run a full layout (without scopeElementId) or use set_bpmn_connection_waypoints to fix any displaced message flow waypoints.'
    : undefined;

  return jsonResult({
    success: true,
    elementCount,
    labelsMoved,
    repositionedCount: result.repositionedCount,
    reroutedCount: result.reroutedCount,
    ...(boundaryEventWarning ? { boundaryEventWarning } : {}),
    ...(laneCrossingMetrics
      ? {
          laneCrossingMetrics: {
            totalLaneFlows: laneCrossingMetrics.totalLaneFlows,
            crossingLaneFlows: laneCrossingMetrics.crossingLaneFlows,
            laneCoherenceScore: laneCrossingMetrics.laneCoherenceScore,
            ...(laneCrossingMetrics.crossingFlowIds
              ? { crossingFlowIds: laneCrossingMetrics.crossingFlowIds }
              : {}),
          },
        }
      : {}),
    ...(sizingIssues.length > 0 ? { containerSizingIssues: sizingIssues } : {}),
    qualityMetrics,
    ...(qualityMetrics.orthogonalFlowPercent < 90
      ? {
          warning:
            `Layout produced ${qualityMetrics.orthogonalFlowPercent}% orthogonal flows ` +
            `(${qualityMetrics.avgBendCount} avg bends/flow). ` +
            `Re-run layout_bpmn_diagram or run validate_bpmn_diagram to identify non-orthogonal segments.`,
        }
      : {}),
    message:
      `Rebuild layout applied to diagram ${diagramId}` +
      `${scopeElementId ? ` (scoped to ${scopeElementId})` : ''}` +
      ` — ${elementCount} elements arranged, ${result.repositionedCount} repositioned, ${result.reroutedCount} connections re-routed`,
    ...(scopeNote ? { scopeNote } : {}),
    ...(diWarnings.length > 0 ? { diWarnings } : {}),
    ...(poolExpansionApplied ? { poolExpansionApplied: true } : {}),
    ...(subprocessesExpanded > 0 ? { subprocessesExpanded } : {}),
    nextSteps: buildNextSteps(
      laneCrossingMetrics,
      sizingIssues,
      poolExpansionApplied,
      qualityMetrics
    ),
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

/**
 * Determine whether pool autosize will run after layout.
 * Used to skip the redundant internal resize in rebuildLayout (task 7b).
 */
function shouldAutosizePools(args: LayoutDiagramArgs, diagram: any): boolean {
  if (args.poolExpansion === false) return false;
  const registry = getService(diagram.modeler, 'elementRegistry');
  return args.poolExpansion === true || isCollaboration(registry);
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
  if (args.dryRun) return handleDryRunLayout(args);

  const { diagramId, scopeElementId } = args;
  const diagram = requireDiagram(diagramId);
  const progress = context?.sendProgress;

  if (scopeElementId) validateScopeElement(diagram, scopeElementId);

  await progress?.(0, 100, 'Preparing layout…');
  const subprocessesExpanded = args.expandSubprocesses ? expandCollapsedSubprocesses(diagram) : 0;
  const preRepairs = repairMissingDiShapes(diagram);

  // Warn when the diagram contains boundary events (issue #16).
  // Full layout may reposition them incorrectly until issues #11 and #14
  // are fully resolved.  This gives users an actionable alternative.
  const boundaryEventRegistry = getService(diagram.modeler, 'elementRegistry');
  const boundaryEventCount = boundaryEventRegistry
    .getAll()
    .filter((el: any) => el.type === 'bpmn:BoundaryEvent').length;
  const boundaryEventWarning =
    boundaryEventCount > 0
      ? `\u26a0 This diagram has ${boundaryEventCount} boundary event(s). ` +
        `Full layout repositions them relative to their host tasks — verify positions after layout. ` +
        `Use labelsOnly: true for label-only cleanup, or scopeElementId to scope layout to one participant.`
      : undefined;

  // Determine whether pool autosize will run after layout (task 7b):
  // when poolExpansion is enabled (or auto-detected), `handleAutosizePoolsAndLanes`
  // will resize pools/lanes — skip the redundant internal resize in rebuildLayout.
  const willAutosize = shouldAutosizePools(args, diagram);

  await progress?.(10, 100, 'Running rebuild layout…');
  const pixelGridSnap = typeof args.gridSnap === 'number' ? args.gridSnap : undefined;
  const result = rebuildLayout(diagram, {
    pinnedElementIds: diagram.pinnedElements,
    skipPoolResize: willAutosize,
    // Pass gridSnap into the rebuild engine so snapLeft() uses the configured
    // grid during the forward pass (not only as a post-processing step).
    gridSnap: pixelGridSnap,
  });

  await progress?.(60, 100, 'Post-processing layout…');
  // applyPixelGridSnap is still applied after rebuild to snap Y coordinates
  // (which are not aligned by snapLeft()) and to handle any residual drift
  // from boundary-event and pool-resize operations.
  if (pixelGridSnap && pixelGridSnap > 0) applyPixelGridSnap(diagram, pixelGridSnap);
  deduplicateDiInModeler(diagram);

  // DI integrity check + post-layout repair (task 6b):
  // Re-run repairMissingDiShapes after layout to recover any pool/lane/flow DI shapes
  // that may have been lost or invalidated by element repositioning (e.g. jsdom
  // headless polyfill inconsistencies with resizeShape on stale element references).
  const postRepairs = repairMissingDiShapes(diagram);
  const allRepairs = [...preRepairs, ...postRepairs];

  if (!scopeElementId) {
    diagram.pinnedElements = undefined;
    diagram.pinnedConnections = undefined;
  }

  await syncXml(diagram);
  resetMutationCounter(diagram);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  await progress?.(70, 100, 'Adjusting labels…');
  const labelsMoved = await adjustAllLabels(diagram);

  await progress?.(85, 100, 'Resizing pools…');
  const poolExpansionApplied = await autosizePools(args, diagram, elementRegistry);

  // Re-apply U-shaped back-edge routing after pool autosize.
  //
  // bpmn-js's MoveShapeHandler.postExecute re-routes all connections attached
  // to moved elements via modeling.layoutConnection() whenever elements are
  // repositioned (e.g. by centerElementsInLanes inside handleAutosizePoolsAndLanes).
  // This overwrites the U-shaped 4-waypoint routing applied inside rebuildLayout().
  // Running applyAllBackEdgeUShapes() again as the very last step ensures the
  // deterministic U-shape is the final routing for all loop-back connections.
  if (poolExpansionApplied) {
    const modeling = getService(diagram.modeler, 'modeling');
    result.reroutedCount += applyAllBackEdgeUShapes(elementRegistry, modeling);
  }

  const layoutResult = buildLayoutResponse({
    diagramId,
    scopeElementId,
    elementCount: countFlowElements(elementRegistry),
    labelsMoved,
    result,
    laneCrossingMetrics: computeLaneCrossingMetrics(elementRegistry),
    sizingIssues: detectContainerSizingIssues(elementRegistry),
    qualityMetrics: computeLayoutQualityMetrics(elementRegistry),
    diWarnings: [...allRepairs, ...checkDiIntegrity(diagram, elementRegistry)],
    poolExpansionApplied,
    subprocessesExpanded,
    boundaryEventWarning,
  });

  return appendLintFeedback(layoutResult, diagram);
}

// Schema extracted to layout-diagram-schema.ts for readability.
export { TOOL_DEFINITION } from './layout-diagram-schema';
