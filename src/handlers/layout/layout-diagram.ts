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

import { type ToolResult, type DiagramState, type ToolContext } from '../../types';
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
  generateDiagramId,
  storeDiagram,
  deleteDiagram,
  createModelerFromXml,
} from '../../diagram-manager';
import {
  applyPixelGridSnap,
  computeDisplacementStats,
  checkDiIntegrity,
  buildLayoutResult,
  repairMissingDiShapes,
  deduplicateDiInModeler,
} from './layout-helpers';
import { handleAutosizePoolsAndLanes } from '../collaboration/autosize-pools-and-lanes';

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

/** Perform a dry-run layout: clone → layout → diff → discard clone. */
async function handleDryRunLayout(args: LayoutDiagramArgs): Promise<ToolResult> {
  const {
    diagramId,
    direction,
    nodeSpacing,
    layerSpacing,
    scopeElementId,
    preserveHappyPath,
    compactness,
    simplifyRoutes,
    elementIds,
  } = args;
  const rawGridSnap = args.gridSnap;
  const elkGridSnap = typeof rawGridSnap === 'boolean' ? rawGridSnap : undefined;
  const pixelGridSnap = typeof rawGridSnap === 'number' ? rawGridSnap : undefined;
  const diagram = requireDiagram(diagramId);

  // Save current XML
  const { xml } = await diagram.modeler.saveXML({ format: true });

  // Create a temporary clone
  const tempId = generateDiagramId();
  const modeler = await createModelerFromXml(xml || '');
  storeDiagram(tempId, { modeler, xml: xml || '', name: `_dryrun_${diagramId}` });

  try {
    const tempDiagram: DiagramState = { modeler, xml: xml || '' };

    // Record original positions
    const tempRegistry = getService(modeler, 'elementRegistry');
    const originalPositions = new Map<string, { x: number; y: number }>();
    for (const el of getVisibleElements(tempRegistry)) {
      if (el.x !== undefined && el.y !== undefined) {
        originalPositions.set(el.id, { x: el.x, y: el.y });
      }
    }

    // Run layout on clone
    let layoutResult: { crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> };

    if (elementIds && elementIds.length > 0) {
      layoutResult = await elkLayoutSubset(tempDiagram, elementIds, {
        direction,
        nodeSpacing,
        layerSpacing,
      });
    } else {
      layoutResult = await elkLayout(tempDiagram, {
        direction,
        nodeSpacing,
        layerSpacing,
        scopeElementId,
        preserveHappyPath,
        gridSnap: elkGridSnap,
        compactness,
        simplifyRoutes,
      });
    }

    if (pixelGridSnap && pixelGridSnap > 0) {
      applyPixelGridSnap(tempDiagram, pixelGridSnap);
    }

    // Compute displacement stats
    const stats = computeDisplacementStats(originalPositions, tempRegistry);
    const crossingCount = layoutResult.crossingFlows ?? 0;

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
      ...(crossingCount > 0 ? { crossingFlows: crossingCount } : {}),
      ...(isLargeChange
        ? {
            warning: `Layout would move ${stats.movedCount}/${totalElements} elements with max displacement of ${stats.maxDisplacement}px. Consider using scopeElementId or elementIds for a more targeted layout.`,
          }
        : {}),
      topDisplacements: stats.displacements,
      message: `Dry run: layout would move ${stats.movedCount}/${totalElements} elements (max ${stats.maxDisplacement}px, avg ${stats.avgDisplacement}px). Call without dryRun to apply.`,
    });
  } finally {
    // Always clean up the temporary clone
    deleteDiagram(tempId);
  }
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

  // Repair missing DI shapes before layout so ELK can position all elements
  const repairs = await repairMissingDiShapes(diagram);

  await progress?.(10, 100, 'Running ELK layout…');
  const { layoutResult, usedDeterministic } = await executeLayout(diagram, layoutArgs);

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
  });
  return appendLintFeedback(result, diagram);
}

/** Snap collapsed pools to match expanded pool horizontal extent after autosize. */
function alignCollapsedPoolsAfterAutosize(elementRegistry: any, modeling: any): void {
  const pools = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
  if (pools.length < 2) return;

  const expanded: any[] = [];
  const collapsed: any[] = [];
  for (const p of pools) {
    const hasChildren =
      elementRegistry.filter(
        (el: any) =>
          el.parent === p &&
          !el.type.includes('Flow') &&
          !el.type.includes('Lane') &&
          el.type !== 'bpmn:Process' &&
          el.type !== 'label'
      ).length > 0;
    if (hasChildren) expanded.push(p);
    else collapsed.push(p);
  }
  if (expanded.length === 0 || collapsed.length === 0) return;

  let minX = Infinity;
  let maxRight = -Infinity;
  for (const p of expanded) {
    if (p.x < minX) minX = p.x;
    if (p.x + (p.width || 0) > maxRight) maxRight = p.x + (p.width || 0);
  }
  const expandedWidth = maxRight - minX;
  for (const pool of collapsed) {
    const dx = Math.round(minX - pool.x);
    if (Math.abs(dx) > 2) modeling.moveElements([pool], { x: dx, y: 0 });
    const cur = elementRegistry.get(pool.id);
    if (Math.abs((cur.width || 0) - expandedWidth) > 5) {
      modeling.resizeShape(cur, {
        x: cur.x,
        y: cur.y,
        width: expandedWidth,
        height: cur.height || 60,
      });
    }
  }
}

// Schema extracted to layout-diagram-schema.ts for readability.
export { TOOL_DEFINITION } from './layout-diagram-schema';
