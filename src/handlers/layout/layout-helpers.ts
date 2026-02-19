/**
 * Layout helpers: displacement stats, DI deduplication, and result building.
 *
 * DI integrity checks and repair are in layout-di-repair.ts.
 * Container sizing detection and quality metrics are in layout-quality-metrics.ts.
 */

import { type ToolResult } from '../../types';
import { jsonResult, getVisibleElements, getService } from '../helpers';
import { getDefinitionsFromModeler } from '../../linter';
import { computeLaneCrossingMetrics } from '../../elk/api';
import {
  detectContainerSizingIssues,
  computeLayoutQualityMetrics,
  type ContainerSizingIssue,
} from './layout-quality-metrics';
export { checkDiIntegrity, repairMissingDiShapes } from './layout-di-repair';

// ── Pixel grid snapping ────────────────────────────────────────────────────

/** Apply pixel-level grid snapping to all visible non-flow elements. */
export function applyPixelGridSnap(diagram: any, pixelGridSnap: number): void {
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
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

// ── Displacement stats for dry-run ─────────────────────────────────────────

export interface DisplacementStats {
  movedCount: number;
  maxDisplacement: number;
  avgDisplacement: number;
  displacements: Array<{ id: string; dx: number; dy: number; distance: number }>;
}

/** Compute layout displacement stats between original and laid-out element positions. */
export function computeDisplacementStats(
  originalPositions: Map<string, { x: number; y: number }>,
  elementRegistry: any
): DisplacementStats {
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

// ── DI deduplication in modeler state ──────────────────────────────────────

/**
 * Remove duplicate BPMNShape/BPMNEdge entries from the modeler's DI plane.
 *
 * When multiple operations create DI entries for the same bpmnElement, the
 * plane's `planeElement` array may contain duplicates.  This function scans
 * the array and removes earlier occurrences, keeping the last (most
 * up-to-date) entry for each referenced element.
 *
 * Returns the number of duplicate entries removed.
 */
export function deduplicateDiInModeler(diagram: any): number {
  try {
    const definitions = getDefinitionsFromModeler(diagram.modeler);
    if (!definitions?.diagrams?.[0]?.plane?.planeElement) return 0;

    const plane = definitions.diagrams[0].plane!;
    const elements: any[] = plane.planeElement!;

    // Map bpmnElement.id → last index
    const lastIndex = new Map<string, number>();
    for (let i = 0; i < elements.length; i++) {
      const refId = elements[i].bpmnElement?.id;
      if (refId) lastIndex.set(refId, i);
    }

    // Collect indices of earlier duplicates
    const toRemove: number[] = [];
    const seen = new Set<string>();
    for (let i = elements.length - 1; i >= 0; i--) {
      const refId = elements[i].bpmnElement?.id;
      if (!refId) continue;
      if (seen.has(refId)) {
        toRemove.push(i);
      }
      seen.add(refId);
    }

    if (toRemove.length === 0) return 0;

    // Remove from highest index first to preserve earlier indices
    toRemove.sort((a, b) => b - a);
    for (const idx of toRemove) {
      elements.splice(idx, 1);
    }

    return toRemove.length;
  } catch {
    return 0;
  }
}

// ── Build layout result ────────────────────────────────────────────────────

/** Build the nextSteps array, adding lane organization and sizing advice when relevant. */
function buildNextSteps(
  laneCrossingMetrics: ReturnType<typeof computeLaneCrossingMetrics>,
  sizingIssues: ContainerSizingIssue[],
  poolExpansionApplied?: boolean
): Array<{ tool: string; description: string }> {
  const steps: Array<{ tool: string; description: string }> = [
    {
      tool: 'export_bpmn',
      description:
        'Diagram layout is complete. Use export_bpmn with format and filePath to save the diagram.',
    },
  ];

  if (laneCrossingMetrics && laneCrossingMetrics.laneCoherenceScore < 70) {
    steps.push({
      tool: 'analyze_bpmn_lanes',
      description: `Lane coherence score is ${laneCrossingMetrics.laneCoherenceScore}% (below 70%). Run analyze_bpmn_lanes with mode: 'validate' for detailed lane improvement suggestions.`,
    });
    steps.push({
      tool: 'redistribute_bpmn_elements_across_lanes',
      description: `Lane coherence is low (${laneCrossingMetrics.laneCoherenceScore}%). Run redistribute_bpmn_elements_across_lanes with validate: true to automatically minimize cross-lane flows.`,
    });
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

  return steps;
}

/** Build the structured layout result JSON with crossing metrics and lane metrics. */
export function buildLayoutResult(params: {
  diagramId: string;
  scopeElementId?: string;
  elementIds?: string[];
  elementCount: number;
  labelsMoved: number;
  layoutResult: { crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> };
  elementRegistry: any;
  usedDeterministic?: boolean;
  diWarnings?: string[];
  poolExpansionApplied?: boolean;
  pinnedSkipped?: string[];
  subprocessesExpanded?: number;
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
    diWarnings,
    poolExpansionApplied,
    pinnedSkipped,
    subprocessesExpanded,
  } = params;
  const crossingCount = layoutResult.crossingFlows ?? 0;
  const crossingPairs = layoutResult.crossingFlowPairs ?? [];
  const laneCrossingMetrics = computeLaneCrossingMetrics(elementRegistry);
  const sizingIssues = detectContainerSizingIssues(elementRegistry);
  const qualityMetrics = computeLayoutQualityMetrics(elementRegistry);

  // C7: message flows crossing the scope boundary are not updated during scoped layout.
  // Surface this as a scopeNote so callers know to re-route them manually if needed.
  const scopeNote = scopeElementId
    ? 'Message flows crossing the scope boundary were not re-routed. Run a full layout (without scopeElementId) or use set_bpmn_connection_waypoints to fix any displaced message flow waypoints.'
    : undefined;

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
    ...(sizingIssues.length > 0 ? { containerSizingIssues: sizingIssues } : {}),
    qualityMetrics: {
      avgFlowLength: qualityMetrics.avgFlowLength,
      orthogonalFlowPercent: qualityMetrics.orthogonalFlowPercent,
      elementDensity: qualityMetrics.elementDensity,
    },
    message: `Layout applied to diagram ${diagramId}${scopeElementId ? ` (scoped to ${scopeElementId})` : ''}${elementIds ? ` (${elementIds.length} elements)` : ''}${usedDeterministic ? ' (deterministic)' : ''} — ${elementCount} elements arranged`,
    ...(scopeNote ? { scopeNote } : {}),
    ...(diWarnings && diWarnings.length > 0 ? { diWarnings } : {}),
    ...(poolExpansionApplied ? { poolExpansionApplied: true } : {}),
    ...(subprocessesExpanded && subprocessesExpanded > 0 ? { subprocessesExpanded } : {}),
    ...(pinnedSkipped && pinnedSkipped.length > 0
      ? {
          pinnedSkipped,
          pinnedNote: `${pinnedSkipped.length} manually-positioned element(s) skipped`,
        }
      : {}),
    nextSteps: buildNextSteps(laneCrossingMetrics, sizingIssues, poolExpansionApplied),
  });
}

/**
 * After autosize, align collapsed partner pools horizontally to match
 * the width and left edge of the expanded (executable) pools.
 */
export function alignCollapsedPoolsAfterAutosize(elementRegistry: any, modeling: any): void {
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
