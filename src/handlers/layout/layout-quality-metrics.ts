/**
 * Layout quality metrics and container sizing analysis.
 *
 * Provides post-layout quality feedback including:
 * - Container (pool/lane) overflow detection with sizing recommendations
 * - Flow orthogonality and bend count metrics
 *
 * Extracted from layout-helpers.ts to keep file sizes under the max-lines limit.
 */

import { SUBPROCESS_INNER_PADDING } from '../../constants';

// ── Pool/Lane overflow detection ───────────────────────────────────────────

/** Margin (px) between element extent and pool/lane edge considered "tight". */
const OVERFLOW_MARGIN = SUBPROCESS_INNER_PADDING;

export interface ContainerSizingIssue {
  containerId: string;
  containerName: string;
  containerType: 'pool' | 'lane';
  currentWidth: number;
  currentHeight: number;
  recommendedWidth: number;
  recommendedHeight: number;
  severity: 'warning' | 'info';
  message: string;
}

/**
 * Detect pools and lanes whose bounds are too small for their contained elements.
 *
 * Returns actionable sizing issues with current and recommended dimensions.
 */
export function detectContainerSizingIssues(elementRegistry: any): ContainerSizingIssue[] {
  const issues: ContainerSizingIssue[] = [];

  // Check participants (pools)
  const participants = elementRegistry.filter(
    (el: any) => el.type === 'bpmn:Participant' && el.children && el.children.length > 0
  );

  for (const pool of participants) {
    const childExtent = computeChildExtent(pool.children);
    if (!childExtent) continue;

    const recommendedW = Math.max(pool.width, childExtent.maxX - pool.x + OVERFLOW_MARGIN);
    const recommendedH = Math.max(pool.height, childExtent.maxY - pool.y + OVERFLOW_MARGIN);

    if (recommendedW > pool.width + 5 || recommendedH > pool.height + 5) {
      const poolName = pool.businessObject?.name || pool.id;
      issues.push({
        containerId: pool.id,
        containerName: poolName,
        containerType: 'pool',
        currentWidth: pool.width,
        currentHeight: pool.height,
        recommendedWidth: Math.ceil(recommendedW / 10) * 10,
        recommendedHeight: Math.ceil(recommendedH / 10) * 10,
        severity: 'warning',
        message:
          `Pool "${poolName}" (${pool.width}×${pool.height}px) is too small for its elements. ` +
          `Recommended: ${Math.ceil(recommendedW / 10) * 10}×${Math.ceil(recommendedH / 10) * 10}px. ` +
          `Use move_bpmn_element with width/height to resize.`,
      });
    }
  }

  // Check lanes
  const lanes = elementRegistry.filter((el: any) => el.type === 'bpmn:Lane');

  for (const lane of lanes) {
    if (!lane.children || lane.children.length === 0) continue;

    const childExtent = computeChildExtent(lane.children);
    if (!childExtent) continue;

    const recommendedH = Math.max(lane.height, childExtent.maxY - lane.y + OVERFLOW_MARGIN);

    if (recommendedH > lane.height + 5) {
      const laneName = lane.businessObject?.name || lane.id;
      issues.push({
        containerId: lane.id,
        containerName: laneName,
        containerType: 'lane',
        currentWidth: lane.width,
        currentHeight: lane.height,
        recommendedWidth: lane.width,
        recommendedHeight: Math.ceil(recommendedH / 10) * 10,
        severity: 'info',
        message:
          `Lane "${laneName}" height (${lane.height}px) is tight for its elements. ` +
          `Recommended height: ${Math.ceil(recommendedH / 10) * 10}px.`,
      });
    }
  }

  return issues;
}

/**
 * Compute the bounding extent of child elements within a container.
 * Returns the maximum x+width and y+height of all children.
 */
function computeChildExtent(children: any[]): { maxX: number; maxY: number } | null {
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const child of children) {
    // Skip connections and lanes (lanes are containers, not content)
    if (
      child.type?.includes('SequenceFlow') ||
      child.type?.includes('MessageFlow') ||
      child.type?.includes('Association') ||
      child.type === 'bpmn:Lane'
    ) {
      continue;
    }

    if (child.x !== undefined && child.y !== undefined) {
      const right = child.x + (child.width || 0);
      const bottom = child.y + (child.height || 0);
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
      found = true;
    }
  }

  return found ? { maxX, maxY } : null;
}

// ── Layout quality metrics ─────────────────────────────────────────────────

export interface LayoutQualityMetrics {
  /** Percentage of sequence flows that are orthogonal (straight or right-angle). */
  orthogonalFlowPercent: number;
  /**
   * Average number of bends (waypoint direction changes) per sequence flow.
   * A 2-waypoint straight flow has 0 bends; each additional waypoint adds a bend.
   */
  avgBendCount: number;
  /**
   * IDs of non-orthogonal sequence flows (present only when orthogonalFlowPercent < 100).
   * Allows callers to target specific flows for manual or automatic straightening.
   */
  nonOrthogonalFlowIds?: string[];
}

/**
 * Compute layout quality metrics for post-layout feedback.
 *
 * Simplified to the two most actionable metrics: orthogonal flow percentage
 * and average bend count.
 */
export function computeLayoutQualityMetrics(elementRegistry: any): LayoutQualityMetrics {
  const allElements = elementRegistry.getAll();

  const flows = allElements.filter(
    (el: any) => el.type === 'bpmn:SequenceFlow' && el.waypoints && el.waypoints.length >= 2
  );

  let orthogonalCount = 0;
  let totalBends = 0;
  const nonOrthogonalFlowIds: string[] = [];

  for (const flow of flows) {
    const wps: Array<{ x: number; y: number }> = flow.waypoints;
    let isOrthogonal = true;

    for (let i = 1; i < wps.length; i++) {
      const dx = wps[i].x - wps[i - 1].x;
      const dy = wps[i].y - wps[i - 1].y;

      // Segment is orthogonal if horizontal or vertical (within 2px tolerance)
      if (Math.abs(dx) > 2 && Math.abs(dy) > 2) {
        isOrthogonal = false;
      }
    }

    if (isOrthogonal) {
      orthogonalCount++;
    } else {
      nonOrthogonalFlowIds.push(flow.id);
    }
    // Bends = number of direction changes = waypoints - 2 (minus start and end)
    totalBends += Math.max(0, wps.length - 2);
  }

  const orthogonalFlowPercent =
    flows.length > 0 ? Math.round((orthogonalCount / flows.length) * 100) : 100;
  const avgBendCount = flows.length > 0 ? Math.round((totalBends / flows.length) * 10) / 10 : 0;

  return {
    orthogonalFlowPercent,
    avgBendCount,
    ...(nonOrthogonalFlowIds.length > 0 ? { nonOrthogonalFlowIds } : {}),
  };
}
