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

import { type ToolResult } from '../../types';
import { requireDiagram, jsonResult, syncXml, getVisibleElements } from '../helpers';
import { appendLintFeedback, resetMutationCounter } from '../../linter';
import { adjustDiagramLabels, adjustFlowLabels, centerFlowLabels } from './labels/adjust-labels';
import {
  elkLayout,
  elkLayoutSubset,
  computeLaneCrossingMetrics,
  applyDeterministicLayout,
} from '../../elk/api';
import {
  generateDiagramId,
  storeDiagram,
  deleteDiagram,
  createModelerFromXml,
} from '../../diagram-manager';

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
}

/** Apply pixel-level grid snapping to all visible non-flow elements. */
function applyPixelGridSnap(diagram: any, pixelGridSnap: number): void {
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const visibleElements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:BoundaryEvent'
  );
  for (const el of visibleElements) {
    const snappedX = Math.round(el.x / pixelGridSnap) * pixelGridSnap;
    const snappedY = Math.round(el.y / pixelGridSnap) * pixelGridSnap;
    if (snappedX !== el.x || snappedY !== el.y) {
      modeling.moveElements([el], { x: snappedX - el.x, y: snappedY - el.y });
    }
  }
}

/** Compute layout displacement stats between original and laid-out element positions. */
function computeDisplacementStats(
  originalPositions: Map<string, { x: number; y: number }>,
  elementRegistry: any
): {
  movedCount: number;
  maxDisplacement: number;
  avgDisplacement: number;
  displacements: Array<{ id: string; dx: number; dy: number; distance: number }>;
} {
  const elements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association')
  );

  const displacements: Array<{ id: string; dx: number; dy: number; distance: number }> = [];
  let maxDisplacement = 0;
  let totalDisplacement = 0;
  let movedCount = 0;

  for (const el of elements) {
    const orig = originalPositions.get(el.id);
    if (!orig) continue;
    const dx = (el.x ?? 0) - orig.x;
    const dy = (el.y ?? 0) - orig.y;
    const distance = Math.round(Math.sqrt(dx * dx + dy * dy));
    if (distance > 1) {
      movedCount++;
      displacements.push({ id: el.id, dx: Math.round(dx), dy: Math.round(dy), distance });
      if (distance > maxDisplacement) maxDisplacement = distance;
      totalDisplacement += distance;
    }
  }

  return {
    movedCount,
    maxDisplacement,
    avgDisplacement: movedCount > 0 ? Math.round(totalDisplacement / movedCount) : 0,
    displacements: displacements.sort((a, b) => b.distance - a.distance).slice(0, 10),
  };
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
    const tempDiagram = { modeler, xml: xml || '' } as any;

    // Record original positions
    const tempRegistry = modeler.get('elementRegistry');
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

/** Build the structured layout result JSON with crossing metrics and lane metrics. */
function buildLayoutResult(params: {
  diagramId: string;
  scopeElementId?: string;
  elementIds?: string[];
  elementCount: number;
  labelsMoved: number;
  layoutResult: { crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> };
  elementRegistry: any;
  usedDeterministic?: boolean;
}): ToolResult {
  const {
    diagramId,
    scopeElementId,
    elementIds,
    elementCount,
    labelsMoved,
    layoutResult,
    elementRegistry,
    usedDeterministic,
  } = params;
  const crossingCount = layoutResult.crossingFlows ?? 0;
  const crossingPairs = layoutResult.crossingFlowPairs ?? [];
  const laneCrossingMetrics = computeLaneCrossingMetrics(elementRegistry);

  return jsonResult({
    success: true,
    elementCount,
    labelsMoved,
    ...(usedDeterministic ? { layoutStrategy: 'deterministic' } : {}),
    ...(crossingCount > 0
      ? {
          crossingFlows: crossingCount,
          crossingFlowPairs: crossingPairs,
          warning: `${crossingCount} crossing sequence flow(s) detected — consider restructuring the process`,
        }
      : {}),
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
    message: `Layout applied to diagram ${diagramId}${scopeElementId ? ` (scoped to ${scopeElementId})` : ''}${elementIds ? ` (${elementIds.length} elements)` : ''}${usedDeterministic ? ' (deterministic)' : ''} — ${elementCount} elements arranged`,
    nextSteps: [
      {
        tool: 'export_bpmn',
        description:
          'Diagram layout is complete. Use export_bpmn with format and filePath to save the diagram.',
      },
    ],
  });
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
  });
  return { layoutResult: result, usedDeterministic: false };
}

export async function handleLayoutDiagram(args: LayoutDiagramArgs): Promise<ToolResult> {
  if (args.dryRun) return handleDryRunLayout(args);

  const { diagramId, scopeElementId, elementIds } = args;
  const pixelGridSnap = typeof args.gridSnap === 'number' ? args.gridSnap : undefined;
  const diagram = requireDiagram(diagramId);

  const { layoutResult, usedDeterministic } = await executeLayout(diagram, args);

  if (pixelGridSnap && pixelGridSnap > 0) applyPixelGridSnap(diagram, pixelGridSnap);

  await syncXml(diagram);
  resetMutationCounter(diagram);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const elements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association')
  );

  // Adjust labels after layout
  await centerFlowLabels(diagram);
  const labelsMoved = await adjustDiagramLabels(diagram);
  const flowLabelsMoved = await adjustFlowLabels(diagram);

  const result = buildLayoutResult({
    diagramId,
    scopeElementId,
    elementIds,
    elementCount: elementIds ? elementIds.length : elements.length,
    labelsMoved: labelsMoved + flowLabelsMoved,
    layoutResult,
    elementRegistry,
    usedDeterministic,
  });
  return appendLintFeedback(result, diagram);
}

// Schema extracted to layout-diagram-schema.ts for readability.
export { TOOL_DEFINITION } from './layout-diagram-schema';
