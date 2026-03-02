/**
 * Core positioning algorithms for the rebuild-based layout engine.
 *
 * Computes target center positions for flow nodes using topological
 * order, gateway branch fan-out/merge patterns, and predecessor-based
 * placement.
 */

import type { BpmnElement } from '../bpmn-types';
import type { FlowGraph, FlowNode } from './topology';
import type { LayeredNode } from './graph';
import type { GatewayPattern } from './patterns';

// ── Constants ──────────────────────────────────────────────────────────────

/** Default origin for the first start event (center coordinates). */
export const DEFAULT_ORIGIN = { x: 180, y: 200 };

// ── Pattern lookup construction ────────────────────────────────────────────

/** Build merge-gateway and branch-element lookup tables from patterns. */
export function buildPatternLookups(patterns: GatewayPattern[]): {
  mergeToPattern: Map<string, GatewayPattern>;
  elementToBranch: Map<string, { pattern: GatewayPattern; branchIndex: number }>;
} {
  const mergeToPattern = new Map<string, GatewayPattern>();
  const elementToBranch = new Map<string, { pattern: GatewayPattern; branchIndex: number }>();

  for (const pattern of patterns) {
    if (pattern.mergeId) {
      mergeToPattern.set(pattern.mergeId, pattern);
    }
    for (let bi = 0; bi < pattern.branches.length; bi++) {
      for (const id of pattern.branches[bi]) {
        elementToBranch.set(id, { pattern, branchIndex: bi });
      }
    }
  }

  return { mergeToPattern, elementToBranch };
}

// ── Overlap resolution ─────────────────────────────────────────────────────

/**
 * Detect and resolve overlapping positions in the computed layout.
 *
 * When two or more elements share identical (x, y) coordinates after
 * `computePositions()`, nudge them vertically apart by branchSpacing/2.
 * This is a safety-net fallback for open-fan parallel patterns where the
 * gateway-pattern detector could not spread branches symmetrically.
 *
 * Elements are grouped by their X coordinate. Within each X group,
 * any elements sharing the same Y are spread out symmetrically around
 * the common Y center using the given spacing.
 */
export function resolvePositionOverlaps(
  positions: Map<string, { x: number; y: number }>,
  branchSpacing: number
): void {
  // Group elements by rounded X coordinate (elements in the same "column")
  const byX = new Map<number, string[]>();
  for (const [id, pos] of positions) {
    const xKey = Math.round(pos.x);
    if (!byX.has(xKey)) byX.set(xKey, []);
    byX.get(xKey)!.push(id);
  }

  // Within each X column, detect same-Y clusters and spread them
  for (const [, columnIds] of byX) {
    if (columnIds.length < 2) continue;

    // Group by rounded Y
    const byY = new Map<number, string[]>();
    for (const id of columnIds) {
      const pos = positions.get(id)!;
      const yKey = Math.round(pos.y);
      if (!byY.has(yKey)) byY.set(yKey, []);
      byY.get(yKey)!.push(id);
    }

    for (const [, cluster] of byY) {
      if (cluster.length < 2) continue;

      // Multiple elements at same (x, y) — spread them vertically
      // Use the cluster's current Y as the center
      const clusterY = positions.get(cluster[0])!.y;
      // Use full branchSpacing (default 130 px) as the spread unit.
      // branchSpacing/2 (65 px) was too tight: standard task height (80 px)
      // plus the STANDARD_BPMN_GAP (50 px) already exceeds 65 px, causing
      // neighbouring branch elements to visually overlap.
      const spacing = branchSpacing;

      for (let i = 0; i < cluster.length; i++) {
        const id = cluster[i];
        const pos = positions.get(id)!;
        const offset = (i - (cluster.length - 1) / 2) * spacing;
        positions.set(id, { x: pos.x, y: clusterY + offset });
      }
    }
  }
}

// ── Position computation ───────────────────────────────────────────────────

/**
 * Compute target center positions for all elements in the flow graph.
 *
 * Elements are positioned in topological order:
 * - Start nodes at the origin column
 * - Branch elements with symmetric vertical offset
 * - Merge gateways aligned after all branches
 * - Other elements to the right of their predecessor
 * - Exception chain elements are skipped (positioned later)
 */
export function computePositions(
  graph: FlowGraph,
  sorted: LayeredNode[],
  backEdgeIds: Set<string>,
  mergeToPattern: Map<string, GatewayPattern>,
  elementToBranch: Map<string, { pattern: GatewayPattern; branchIndex: number }>,
  origin: { x: number; y: number },
  gap: number,
  branchSpacing: number,
  excludeIds?: Set<string>,
  elementLaneYs?: Map<string, number>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Pre-place start nodes at the origin column, stacked vertically
  let startY = origin.y;
  for (const startId of graph.startNodeIds) {
    if (excludeIds?.has(startId)) continue;
    if (graph.nodes.has(startId)) {
      positions.set(startId, { x: origin.x, y: startY });
      startY += branchSpacing;
    }
  }

  // Process remaining elements in topological order
  for (const { elementId } of sorted) {
    if (positions.has(elementId)) continue;
    if (excludeIds?.has(elementId)) continue;

    const node = graph.nodes.get(elementId);
    if (!node) continue;

    if (mergeToPattern.has(elementId)) {
      positionMerge(positions, mergeToPattern.get(elementId)!, node.element, gap, graph);
    } else if (elementToBranch.has(elementId)) {
      const { pattern, branchIndex } = elementToBranch.get(elementId)!;
      positionBranchElement(
        positions,
        pattern,
        branchIndex,
        elementId,
        node.element,
        gap,
        branchSpacing,
        graph,
        elementLaneYs
      );
    } else {
      positionAfterPredecessor(positions, node, node.element, gap, backEdgeIds, elementLaneYs);
    }
  }

  return positions;
}

// ── Individual positioning strategies ──────────────────────────────────────

/**
 * Position an element to the right of its rightmost positioned predecessor,
 * at the same Y as that predecessor.  Ignores back-edge predecessors.
 *
 * When the element belongs to a specific lane (elementLaneYs provided),
 * the Y is overridden with the lane's estimated center Y (task 3a).
 */
function positionAfterPredecessor(
  positions: Map<string, { x: number; y: number }>,
  node: FlowNode,
  element: BpmnElement,
  gap: number,
  backEdgeIds: Set<string>,
  elementLaneYs?: Map<string, number>
): void {
  // Collect positioned forward predecessors
  const predecessors: Array<{ element: BpmnElement; pos: { x: number; y: number } }> = [];
  for (let i = 0; i < node.incoming.length; i++) {
    if (backEdgeIds.has(node.incomingFlowIds[i])) continue;
    const predId = node.incoming[i].element.id;
    const pos = positions.get(predId);
    if (pos) {
      predecessors.push({ element: node.incoming[i].element, pos });
    }
  }

  if (predecessors.length === 0) {
    // Fallback for disconnected elements
    positions.set(element.id, { x: DEFAULT_ORIGIN.x, y: DEFAULT_ORIGIN.y });
    return;
  }

  // Use the rightmost predecessor for X placement and Y alignment
  let best = predecessors[0];
  let maxRight = best.pos.x + best.element.width / 2;
  for (const p of predecessors) {
    const rightEdge = p.pos.x + p.element.width / 2;
    if (rightEdge > maxRight) {
      maxRight = rightEdge;
      best = p;
    }
  }

  positions.set(element.id, {
    x: maxRight + gap + element.width / 2,
    y: elementLaneYs?.get(element.id) ?? best.pos.y,
  });
}

/**
 * Position a branch element with symmetric vertical offset from the
 * split gateway.
 *
 * Vertical offsets for N branches (centered on split gateway Y):
 *   2 branches → ±branchSpacing/2
 *   3 branches → -branchSpacing, 0, +branchSpacing
 *   N branches → (i - (N-1)/2) * branchSpacing
 *
 * When the element belongs to a specific lane (elementLaneYs provided),
 * the lane's estimated center Y is used instead of the symmetric offset.
 * This aligns parallel branches with their assigned lanes (task 3c).
 */
function positionBranchElement(
  positions: Map<string, { x: number; y: number }>,
  pattern: GatewayPattern,
  branchIndex: number,
  elementId: string,
  element: BpmnElement,
  gap: number,
  branchSpacing: number,
  graph: FlowGraph,
  elementLaneYs?: Map<string, number>
): void {
  const splitPos = positions.get(pattern.splitId);
  if (!splitPos) {
    positions.set(elementId, { x: DEFAULT_ORIGIN.x, y: DEFAULT_ORIGIN.y });
    return;
  }

  // Symmetric branch Y offset — overridden by lane Y when known
  const numBranches = pattern.branches.length;
  const rawOffset = (branchIndex - (numBranches - 1) / 2) * branchSpacing;
  // Snap to nearest multiple of 10 using absolute-value rounding so that
  // positive and negative offsets snap symmetrically (e.g. ±65 → ±70).
  // This aligns branch element top-left Y coordinates to the 10px grid.
  const branchOffset = Math.sign(rawOffset) * Math.round(Math.abs(rawOffset) / 10) * 10;
  const branchY = elementLaneYs?.get(elementId) ?? splitPos.y + branchOffset;

  // X based on position within the branch
  const branch = pattern.branches[branchIndex];
  const indexInBranch = branch.indexOf(elementId);

  let prevRight: number;
  if (indexInBranch <= 0) {
    // First element in branch: predecessor is the split gateway
    const splitNode = graph.nodes.get(pattern.splitId);
    prevRight = splitPos.x + (splitNode?.element.width ?? 50) / 2;
  } else {
    // Previous element in the same branch
    const prevId = branch[indexInBranch - 1];
    const prevPos = positions.get(prevId);
    const prevNode = graph.nodes.get(prevId);
    prevRight = (prevPos?.x ?? splitPos.x) + (prevNode?.element.width ?? 100) / 2;
  }

  positions.set(elementId, {
    x: prevRight + gap + element.width / 2,
    y: branchY,
  });
}

/**
 * Position a merge gateway after all branches of its split pattern.
 *
 * X: to the right of the rightmost branch endpoint + gap.
 * Y: same as the split gateway (centered between branches).
 */
function positionMerge(
  positions: Map<string, { x: number; y: number }>,
  pattern: GatewayPattern,
  element: BpmnElement,
  gap: number,
  graph: FlowGraph
): void {
  const splitPos = positions.get(pattern.splitId);
  if (!splitPos) {
    positions.set(element.id, { x: DEFAULT_ORIGIN.x, y: DEFAULT_ORIGIN.y });
    return;
  }

  // Find the maximum right edge across all branch endpoints
  const splitNode = graph.nodes.get(pattern.splitId);
  let maxRight = splitPos.x + (splitNode?.element.width ?? 50) / 2;

  for (const branch of pattern.branches) {
    if (branch.length > 0) {
      const lastId = branch[branch.length - 1];
      const lastPos = positions.get(lastId);
      const lastNode = graph.nodes.get(lastId);
      if (lastPos && lastNode) {
        const rightEdge = lastPos.x + lastNode.element.width / 2;
        if (rightEdge > maxRight) maxRight = rightEdge;
      }
    }
  }

  // TODO #3: safety net for unequal-length branches.
  // If any branch's last-element centre-x is within gap/2 of the initial
  // join position, the join would visually abut that branch endpoint.
  // Add one extra gap to ensure a clear visual separation.
  const initialJoinX = maxRight + gap + element.width / 2;
  let extraGap = 0;
  for (const branch of pattern.branches) {
    if (branch.length > 0) {
      const lastId = branch[branch.length - 1];
      const lastPos = positions.get(lastId);
      if (lastPos && lastPos.x >= initialJoinX - gap / 2) {
        extraGap = gap;
        break;
      }
    }
  }

  positions.set(element.id, {
    x: initialJoinX + extraGap,
    y: splitPos.y,
  });
}
