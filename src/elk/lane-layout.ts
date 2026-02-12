/**
 * Post-ELK lane repositioning.
 *
 * Lanes are excluded from the ELK graph (they are structural containers,
 * not flow nodes). After ELK lays out the flow elements within a
 * participant pool, this module:
 *
 * 1. Shifts flow nodes vertically so that each lane's nodes occupy a
 *    separate Y-band (ELK places them all on one row).
 * 2. Resizes the participant pool to encompass all lane bands.
 * 3. Positions and resizes each lane to tile vertically inside the pool.
 *
 * Lane–flow-node assignment comes from the BPMN model's
 * `bpmn:Lane.flowNodeRef` collection, which bpmn-js preserves in
 * `lane.businessObject.flowNodeRef`.
 *
 * **Important:** The `flowNodeRef` arrays get mutated by bpmn-js when
 * `modeling.moveElements` shifts nodes across lane boundaries.  The
 * original assignments must be captured **before** any layout passes
 * via `saveLaneNodeAssignments()` and passed in to `repositionLanes()`.
 */

/** Saved lane → node ID mapping, keyed by lane ID. */
export type LaneNodeAssignments = Map<string, Set<string>>;

import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';

/**
 * Saved lane metadata: original Y-position (from DI coordinates)
 * and assigned flow node IDs.
 */
interface LaneSnapshot {
  laneId: string;
  originalY: number;
  nodeIds: Set<string>;
}

/** Minimum lane height in pixels. */
const MIN_LANE_HEIGHT = 250;

/** Left label band width (px) inside a participant pool. */
const POOL_LABEL_BAND = 30;

/** Vertical padding (px) above/below content within each lane band. */
const LANE_VERTICAL_PADDING = 30;

/**
 * Capture lane → flow-node assignments before layout mutates them.
 *
 * bpmn-js's `modeling.moveElements` updates `lane.businessObject.flowNodeRef`
 * when a node crosses lane boundaries.  This function snapshots the original
 * assignments so `repositionLanes()` can use them later.
 *
 * Call this **before** any ELK layout passes (before `applyElkPositions`).
 */
export function saveLaneNodeAssignments(elementRegistry: ElementRegistry): LaneSnapshot[] {
  const snapshots: LaneSnapshot[] = [];
  const lanes = elementRegistry.filter((el) => el.type === 'bpmn:Lane');

  for (const lane of lanes) {
    const bo = lane.businessObject;
    const refs = (bo?.flowNodeRef || []) as Array<{ id: string }>;
    const nodeIds = new Set<string>();

    for (const ref of refs) {
      const shape = elementRegistry.get(ref.id);
      if (shape) {
        nodeIds.add(shape.id);
      }
    }

    snapshots.push({
      laneId: lane.id,
      originalY: lane.y,
      nodeIds,
    });
  }

  return snapshots;
}

/**
 * Reposition lanes and their flow nodes inside participant pools after
 * ELK layout.
 *
 * ELK treats all flow nodes in a pool as a flat graph without lane
 * awareness.  After ELK positioning (and centreElementsInPools), all
 * nodes sit on roughly the same row.  This function separates them
 * into distinct vertical bands — one per lane — so the final layout
 * shows clear lane boundaries.
 *
 * @param savedAssignments  Lane snapshots from `saveLaneNodeAssignments()`,
 *   captured before layout.  If empty/undefined, falls back to reading
 *   the (possibly mutated) `flowNodeRef` from the business objects.
 */
export function repositionLanes(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  savedAssignments?: LaneSnapshot[]
): void {
  const participants = elementRegistry.filter((el) => el.type === 'bpmn:Participant');

  for (const pool of participants) {
    const lanes = elementRegistry.filter((el) => el.type === 'bpmn:Lane' && el.parent === pool);

    if (lanes.length === 0) continue;

    // Build lane → flow node IDs mapping.
    // Prefer saved assignments (captured before layout mutated flowNodeRef).
    const laneNodeMap = new Map<string, Set<string>>();
    let orderedLanes: BpmnElement[];

    if (savedAssignments && savedAssignments.length > 0) {
      // Filter saved snapshots to lanes in this pool
      const poolLaneIds = new Set(lanes.map((l) => l.id));
      const poolSnapshots = savedAssignments.filter((s) => poolLaneIds.has(s.laneId));

      // Sort lanes by their original DI Y-position (before layout moved them)
      const originalYMap = new Map<string, number>();
      for (const snap of poolSnapshots) {
        laneNodeMap.set(snap.laneId, snap.nodeIds);
        originalYMap.set(snap.laneId, snap.originalY);
      }

      orderedLanes = [...lanes].sort((a, b) => {
        const ya = originalYMap.get(a.id) ?? a.y;
        const yb = originalYMap.get(b.id) ?? b.y;
        return ya - yb;
      });
    } else {
      // Fallback: read from (possibly mutated) flowNodeRef
      const fallbackMap = buildLaneNodeMap(lanes, elementRegistry);
      for (const [k, v] of fallbackMap) laneNodeMap.set(k, v);
      orderedLanes = [...lanes].sort((a, b) => a.y - b.y);
    }

    // Skip if no lane has any assigned nodes
    const hasNodes = Array.from(laneNodeMap.values()).some((s) => s.size > 0);
    if (!hasNodes) continue;

    // Compute the height of node content in each lane (single-row height)
    const laneContentHeight = new Map<string, number>();
    for (const lane of orderedLanes) {
      const nodeIds = laneNodeMap.get(lane.id);
      if (!nodeIds || nodeIds.size === 0) {
        laneContentHeight.set(lane.id, 0);
        continue;
      }
      let maxH = 0;
      for (const nodeId of nodeIds) {
        const shape = elementRegistry.get(nodeId);
        if (shape) {
          const h = shape.height || 0;
          if (h > maxH) maxH = h;
        }
      }
      laneContentHeight.set(lane.id, maxH);
    }

    // Compute lane band heights (content height + vertical padding, min enforced)
    const laneBandHeights = new Map<string, number>();
    for (const lane of orderedLanes) {
      const contentH = laneContentHeight.get(lane.id) || 0;
      const bandH = Math.max(contentH + LANE_VERTICAL_PADDING * 2, MIN_LANE_HEIGHT);
      laneBandHeights.set(lane.id, bandH);
    }

    // Total minimum height for all lane bands
    let totalLaneHeight = Array.from(laneBandHeights.values()).reduce((a, b) => a + b, 0);

    // If the pool is taller than the minimum, scale lane heights
    // proportionally to fill the pool.  This preserves the relative
    // sizing while using all available vertical space.
    const poolX = pool.x;
    const poolY = pool.y;
    const poolWidth = pool.width;

    if (pool.height > totalLaneHeight) {
      const scale = pool.height / totalLaneHeight;
      for (const lane of orderedLanes) {
        const scaled = Math.round(laneBandHeights.get(lane.id)! * scale);
        laneBandHeights.set(lane.id, scaled);
      }
      totalLaneHeight = pool.height;
    }

    // Resize pool to fit all lane bands (only if it needs to grow)
    const newPoolHeight = totalLaneHeight;

    if (Math.abs(pool.height - newPoolHeight) > 1) {
      modeling.resizeShape(pool, {
        x: poolX,
        y: poolY,
        width: poolWidth,
        height: newPoolHeight,
      });
    }

    // Compute Y-band for each lane
    const laneBandY = new Map<string, number>();
    let currentBandY = poolY;
    for (const lane of orderedLanes) {
      laneBandY.set(lane.id, currentBandY);
      currentBandY += laneBandHeights.get(lane.id)!;
    }

    // Move flow nodes into their lane's Y-band.
    // Each node is vertically centred in its lane band.
    for (const lane of orderedLanes) {
      const nodeIds = laneNodeMap.get(lane.id);
      if (!nodeIds || nodeIds.size === 0) continue;

      const bandY = laneBandY.get(lane.id)!;
      const bandH = laneBandHeights.get(lane.id)!;
      const bandCentreY = bandY + bandH / 2;

      const shapes: BpmnElement[] = [];
      for (const nodeId of nodeIds) {
        const shape = elementRegistry.get(nodeId);
        if (shape) shapes.push(shape);
      }

      if (shapes.length === 0) continue;

      // Compute median Y-centre of the lane's nodes (they are likely
      // on the same row after ELK + centreElementsInPools)
      const yCentres = shapes.map((s) => s.y + (s.height || 0) / 2);
      yCentres.sort((a, b) => a - b);
      const medianCentre = yCentres[Math.floor(yCentres.length / 2)];

      const dy = Math.round(bandCentreY - medianCentre);

      if (Math.abs(dy) > 1) {
        modeling.moveElements(shapes, { x: 0, y: dy });
      }
    }

    // Position and resize each lane to tile vertically inside the pool
    const laneX = poolX + POOL_LABEL_BAND;
    const laneWidth = poolWidth - POOL_LABEL_BAND;

    for (const lane of orderedLanes) {
      const targetY = laneBandY.get(lane.id)!;
      const targetH = laneBandHeights.get(lane.id)!;

      // Resize lane to target dimensions
      modeling.resizeShape(lane, {
        x: laneX,
        y: targetY,
        width: laneWidth,
        height: targetH,
      });
    }
  }
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Build a map of lane ID → set of flow node element IDs.
 *
 * Uses the BPMN model's `lane.businessObject.flowNodeRef` which contains
 * references to the flow node business objects assigned to each lane.
 */
function buildLaneNodeMap(
  lanes: BpmnElement[],
  elementRegistry: ElementRegistry
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const lane of lanes) {
    const bo = lane.businessObject;
    const refs = (bo?.flowNodeRef || []) as Array<{ id: string }>;
    const nodeIds = new Set<string>();

    for (const ref of refs) {
      // flowNodeRef contains business objects; find the corresponding shape
      const shape = elementRegistry.get(ref.id);
      if (shape) {
        nodeIds.add(shape.id);
      }
    }

    if (nodeIds.size > 0) {
      map.set(lane.id, nodeIds);
    }
  }

  return map;
}
