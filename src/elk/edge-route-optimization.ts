/**
 * Edge route rebuilding and optimization passes.
 *
 * Rebuilds off-row gateway routes, separates overlapping collinear flows,
 * routes loopback (backward) connections below the main path, and bundles
 * parallel flows between the same source→target pair (E4).
 * These passes change the overall route topology, unlike the endpoint
 * fixes in edge-endpoint-fix.ts.
 *
 * Extracted from edge-routing-fix.ts to separate topology-changing
 * route optimization from endpoint repair.
 */

import { isConnection } from './helpers';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { deduplicateWaypoints, buildZShapeRoute } from './edge-routing-helpers';
import {
  DIFFERENT_ROW_MIN_Y,
  SAME_ROW_Y_TOLERANCE,
  COLLINEAR_DETOUR_OFFSET,
  MIN_GATEWAY_PARALLEL_GAP,
  MAX_GATEWAY_EXIT_Y_DIFF,
  LOOPBACK_BELOW_MARGIN,
  LOOPBACK_ABOVE_MARGIN,
  LOOPBACK_HORIZONTAL_MARGIN,
} from './constants';

// ── Rebuild off-row gateway routes ──────────────────────────────────────────

/**
 * Rebuild flat horizontal routes for gateway connections that now span
 * different Y rows.
 *
 * **Problem:** ELK may place a gateway and its branch target on the same
 * row, producing a flat 2-waypoint horizontal route.  Post-ELK grid snap
 * and happy-path alignment can then move elements to different rows,
 * leaving a flat route that should be an L-bend.
 *
 * **Fix:** Detect connections where:
 * - Source or target is a gateway
 * - Source and target centres are now on different Y rows (ΔY > threshold)
 * - Current route is a flat or near-flat 2-waypoint horizontal line
 *
 * Rebuild these as 3-waypoint L-bends matching bpmn-js conventions:
 * - **Split gateway → off-row target:** exit gateway bottom/top edge at
 *   gateway centre-X, go vertically to target centre-Y, then horizontally
 *   to target left edge.
 * - **Off-row source → join gateway:** exit source right edge at source
 *   centre-Y, go horizontally to gateway centre-X, then vertically into
 *   gateway bottom/top edge.
 *
 * Also rebuilds flat routes for **non-gateway** off-row connections
 * (e.g. exclusive gateway → task via a default flow that isn't marked
 * as a gateway outgoing in the topology) using a Z-shape through the
 * midpoint.
 */
export function rebuildOffRowGatewayRoutes(
  elementRegistry: ElementRegistry,
  modeling: Modeling
): void {
  const BPMN_SEQUENCE_FLOW = 'bpmn:SequenceFlow';
  const BPMN_BOUNDARY_EVENT = 'bpmn:BoundaryEvent';

  const connections = elementRegistry.filter(
    (el) =>
      el.type === BPMN_SEQUENCE_FLOW &&
      !!el.source &&
      !!el.target &&
      !!el.waypoints &&
      el.waypoints.length >= 2 &&
      el.source.type !== BPMN_BOUNDARY_EVENT
  );

  for (const conn of connections) {
    const src = conn.source!;
    const tgt = conn.target!;
    const wps: Array<{ x: number; y: number }> = conn.waypoints!;

    const srcCx = Math.round(src.x + (src.width || 0) / 2);
    const srcCy = Math.round(src.y + (src.height || 0) / 2);
    const srcRight = src.x + (src.width || 0);
    const tgtCx = Math.round(tgt.x + (tgt.width || 0) / 2);
    const tgtCy = Math.round(tgt.y + (tgt.height || 0) / 2);
    const tgtLeft = tgt.x;

    // Only process if source and target are on different rows
    const yCentreDiff = Math.abs(srcCy - tgtCy);
    if (yCentreDiff < DIFFERENT_ROW_MIN_Y) continue;

    // Target must be to the right of source
    if (tgtLeft <= srcRight) continue;

    const srcIsGateway = src.type?.includes('Gateway');
    const tgtIsGateway = tgt.type?.includes('Gateway');

    // For non-gateway off-row connections, only process routes that are
    // flat or near-flat (all waypoints within a small Y band).
    // For gateway branches, ALWAYS rebuild to canonical L-bends regardless
    // of existing waypoint structure — ELK and simplifyGatewayBranchRoutes
    // produce Z-shapes exiting the gateway right edge, but the bpmn-js
    // convention is to exit from top/bottom of the diamond.
    if (!srcIsGateway && !tgtIsGateway) {
      const yValues = wps.map((wp) => wp.y);
      const yRange = Math.max(...yValues) - Math.min(...yValues);
      if (yRange > DIFFERENT_ROW_MIN_Y) continue; // Already has vertical movement
    }

    if (srcIsGateway) {
      // Split gateway → off-row target: L-bend from gateway edge
      // Exit from gateway bottom (if target is below) or top (if above)
      const goDown = tgtCy > srcCy;
      const exitY = goDown ? src.y + (src.height || 0) : src.y;
      const newWps = [
        { x: srcCx, y: Math.round(exitY) },
        { x: srcCx, y: tgtCy },
        { x: Math.round(tgtLeft), y: tgtCy },
      ];
      modeling.updateWaypoints(conn, newWps);
    } else if (tgtIsGateway) {
      // Off-row source → join gateway: L-bend into gateway edge
      // Enter gateway from bottom (if source is below) or top (if above)
      const enterFromBelow = srcCy > tgtCy;
      const gwEntryY = enterFromBelow ? tgt.y + (tgt.height || 0) : tgt.y;
      const newWps = [
        { x: Math.round(srcRight), y: srcCy },
        { x: tgtCx, y: srcCy },
        { x: tgtCx, y: Math.round(gwEntryY) },
      ];
      modeling.updateWaypoints(conn, newWps);
    } else {
      // Non-gateway off-row connection: Z-shape through midpoint
      modeling.updateWaypoints(conn, buildZShapeRoute(srcRight, srcCy, tgtLeft, tgtCy));
    }
  }
}

// ── Overlapping collinear gateway flow separation ──────────────────────────

/**
 * Check if two horizontal segments (same Y) overlap along the X axis.
 * Returns the overlap length, or 0 if they don't overlap.
 */
function horizontalOverlapLength(a1x: number, a2x: number, b1x: number, b2x: number): number {
  const aMin = Math.min(a1x, a2x);
  const aMax = Math.max(a1x, a2x);
  const bMin = Math.min(b1x, b2x);
  const bMax = Math.max(b1x, b2x);
  const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  return Math.max(0, overlap);
}

/**
 * Detect and fix overlapping collinear flows from the same gateway.
 *
 * **Problem:** When an exclusive gateway has a "skip-ahead" branch that
 * bypasses an intermediate element, both the happy-path flow and the
 * skip flow share the same horizontal line from the gateway to the
 * intermediate element.  They are visually indistinguishable.
 *
 * **Fix:** Detect pairs of flows from the same gateway that share a
 * horizontal segment (same Y, overlapping X range).  Reroute the
 * longer (skip-ahead) flow with a small vertical detour: up from the
 * gateway right edge, horizontal above, then down to the target.
 *
 * Should run after all edge routing passes (applyElkEdgeRoutes,
 * simplifyGatewayBranchRoutes, fixDisconnectedEdges, etc.) but
 * before crossing detection.
 */
export function separateOverlappingGatewayFlows(
  elementRegistry: ElementRegistry,
  modeling: Modeling
): void {
  const connections = elementRegistry.filter(
    (el) =>
      el.type === 'bpmn:SequenceFlow' &&
      !!el.source &&
      !!el.target &&
      !!el.waypoints &&
      el.waypoints.length >= 2
  );

  // Group connections by source gateway
  const gwFlows = new Map<string, typeof connections>();
  for (const conn of connections) {
    const src = conn.source!;
    if (!src.type?.includes('Gateway')) continue;
    const group = gwFlows.get(src.id) || [];
    group.push(conn);
    gwFlows.set(src.id, group);
  }

  for (const [, flows] of gwFlows) {
    if (flows.length < 2) continue;

    // Check all pairs of flows from this gateway for collinear overlap
    for (let i = 0; i < flows.length; i++) {
      for (let j = i + 1; j < flows.length; j++) {
        const flowA = flows[i];
        const flowB = flows[j];
        const wpsA: Array<{ x: number; y: number }> = flowA.waypoints!;
        const wpsB: Array<{ x: number; y: number }> = flowB.waypoints!;

        // Only handle the common case: both flows start with a horizontal
        // segment from the gateway (first segment is same-Y)
        if (wpsA.length < 2 || wpsB.length < 2) continue;

        const aY = wpsA[0].y;
        const bY = wpsB[0].y;
        const yDiff = Math.abs(aY - bY);

        // Both first segments must be on the same horizontal line
        if (yDiff > 3) {
          // ── Near-parallel check (Fix Story-06) ────────────────────────
          // Flows that exit the same gateway at slightly different Y values
          // (gateway port offset ≤ MAX_GATEWAY_EXIT_Y_DIFF) but are still
          // effectively horizontal can appear visually too close.  Enforce a
          // minimum vertical gap by rerouting the upper flow further above.
          if (
            yDiff <= MAX_GATEWAY_EXIT_Y_DIFF &&
            Math.abs(wpsA[0].y - wpsA[1].y) <= 3 &&
            Math.abs(wpsB[0].y - wpsB[1].y) <= 3 &&
            yDiff < MIN_GATEWAY_PARALLEL_GAP
          ) {
            const xOverlap = horizontalOverlapLength(wpsA[0].x, wpsA[1].x, wpsB[0].x, wpsB[1].x);
            if (xOverlap > 10) {
              // Route the upper flow (smaller Y) further above the lower flow
              const upperFlow = aY <= bY ? flowA : flowB;
              const lowerY = Math.max(aY, bY);
              const newUpperY = lowerY - MIN_GATEWAY_PARALLEL_GAP;

              const upSrc = upperFlow.source!;
              const upTgt = upperFlow.target!;
              const upSrcRight = upSrc.x + (upSrc.width || 0);
              const upSrcCy = upSrc.y + (upSrc.height || 0) / 2;
              const upTgtLeft = upTgt.x;
              const upTgtCy = upTgt.y + (upTgt.height || 0) / 2;

              if (Math.abs(upSrcCy - upTgtCy) <= SAME_ROW_Y_TOLERANCE) {
                const newWps = [
                  { x: Math.round(upSrcRight), y: Math.round(upSrcCy) },
                  { x: Math.round(upSrcRight), y: Math.round(newUpperY) },
                  { x: Math.round(upTgtLeft), y: Math.round(newUpperY) },
                  { x: Math.round(upTgtLeft), y: Math.round(upTgtCy) },
                ];
                modeling.updateWaypoints(upperFlow, deduplicateWaypoints(newWps));
              }
            }
          }
          continue;
        }
        if (Math.abs(wpsA[0].y - wpsA[1].y) > 3) continue;
        if (Math.abs(wpsB[0].y - wpsB[1].y) > 3) continue;

        // Check for X overlap
        const overlap = horizontalOverlapLength(wpsA[0].x, wpsA[1].x, wpsB[0].x, wpsB[1].x);

        // Only fix when the overlap is significant (> 10px)
        if (overlap <= 10) continue;

        // The longer horizontal segment is the "skip-ahead" flow — reroute it
        const aLen = Math.abs(wpsA[1].x - wpsA[0].x);
        const bLen = Math.abs(wpsB[1].x - wpsB[0].x);
        const longerFlow = aLen >= bLen ? flowA : flowB;

        const src = longerFlow.source!;
        const tgt = longerFlow.target!;
        const srcRight = src.x + (src.width || 0);
        const srcCy = src.y + (src.height || 0) / 2;
        const tgtLeft = tgt.x;
        const tgtCy = tgt.y + (tgt.height || 0) / 2;
        const flowY = longerFlow.waypoints![0].y;

        // Detour above the flow line to avoid overlapping the shorter flow
        const detourY = flowY - COLLINEAR_DETOUR_OFFSET;

        // Build rerouted waypoints: gateway exit → up → horizontal → down to target
        // Only for same-row targets; different-row targets are handled elsewhere
        if (Math.abs(srcCy - tgtCy) <= SAME_ROW_Y_TOLERANCE) {
          const newWps = [
            { x: Math.round(srcRight), y: Math.round(srcCy) },
            { x: Math.round(srcRight), y: Math.round(detourY) },
            { x: Math.round(tgtLeft), y: Math.round(detourY) },
            { x: Math.round(tgtLeft), y: Math.round(tgtCy) },
          ];
          modeling.updateWaypoints(longerFlow, deduplicateWaypoints(newWps));
        }
      }
    }
  }
}

// ── Loopback routing below main path ───────────────────────────────────────

/**
 * Route loopback (backward) connections below the main process path.
 *
 * **Problem:** When ELK handles cycles, it reverses back-edges during
 * layout.  After applying positions, these reversed edge routes may cut
 * through the main process path area, creating visual confusion.  Loopback
 * connections should route clearly below (or above) the main flow so they
 * are visually distinct from forward flows.
 *
 * **Fix:** Detect sequence flows where the target is to the left of the
 * source (backward flow).  Rebuild their routes as a clean U-shape:
 *
 * ```
 *          ┌── target ◄──────────────────┐
 *          │                              │
 *          │   task → task → gateway ─────┘
 *          │                    │
 *          └────────────────────┘  (routed below)
 * ```
 *
 * Route: exit source bottom/right → go down below the lowest element →
 * go left → go up into target bottom/left.
 *
 * Skips boundary event connections and message flows.
 * Should run after all other edge routing passes.
 */
/**
 * Route backward (loopback) sequence flows around the main path.
 *
 * **E8 — Bidirectional loopback routing:**
 * The routing direction is chosen based on the relative Y positions of the
 * source and target:
 * - If the **target is above** the source (tgtCy < srcCy), the loopback is
 *   routed **above** the topmost element in the scope.  This produces a
 *   cleaner U-shape for flows that go "up-and-back" in the diagram.
 * - Otherwise the loopback is routed **below** the bottommost element
 *   (original behaviour), which is appropriate for same-row and
 *   below-source targets.
 *
 * In collaboration diagrams the scope top/bottom is computed per-participant
 * to avoid routing loopbacks outside a pool's visual boundaries.
 */
export function routeLoopbacksBelow(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const BPMN_SEQUENCE_FLOW = 'bpmn:SequenceFlow';
  const BPMN_BOUNDARY_EVENT = 'bpmn:BoundaryEvent';

  const allElements: BpmnElement[] = elementRegistry.getAll();

  // Pre-compute the bottom boundary per participant scope.
  // In collaboration diagrams, loopbacks should route below the elements
  // within their own pool, not below ALL elements across all pools.
  const scopeBottoms = new Map<string, number>();
  const globalKey = '__global__';

  // E8: Also compute the top boundary per scope so above-loopbacks stay
  // inside their pool.
  const scopeTops = new Map<string, number>();

  for (const el of allElements) {
    if (
      isConnection(el.type) ||
      el.type === BPMN_BOUNDARY_EVENT ||
      el.type === 'bpmn:Participant' ||
      el.type === 'bpmn:Lane' ||
      el.type === 'label'
    ) {
      continue;
    }
    const bottom = (el.y ?? 0) + (el.height ?? 0);

    // Find the participant scope for this element
    let scopeId = globalKey;
    let parent = el.parent;
    while (parent) {
      if (parent.type === 'bpmn:Participant') {
        scopeId = parent.id;
        break;
      }
      parent = parent.parent;
    }

    const current = scopeBottoms.get(scopeId) ?? 0;
    if (bottom > current) scopeBottoms.set(scopeId, bottom);

    // E8: track scope-top (minimum y of any flow element in the scope)
    const top = el.y ?? 0;
    const currentTop = scopeTops.get(scopeId) ?? Infinity;
    if (top < currentTop) scopeTops.set(scopeId, top);
  }

  // Also maintain a global bottom for diagrams without participants
  let globalBottom = 0;
  let globalTop = Infinity;
  for (const bottom of scopeBottoms.values()) {
    if (bottom > globalBottom) globalBottom = bottom;
  }
  for (const top of scopeTops.values()) {
    if (top < globalTop) globalTop = top;
  }
  if (!scopeBottoms.has(globalKey)) {
    scopeBottoms.set(globalKey, globalBottom);
  }
  if (!scopeTops.has(globalKey)) {
    scopeTops.set(globalKey, globalTop === Infinity ? 0 : globalTop);
  }

  if (globalBottom === 0) return;

  const connections = allElements.filter(
    (el) =>
      el.type === BPMN_SEQUENCE_FLOW &&
      !!el.source &&
      !!el.target &&
      !!el.waypoints &&
      el.waypoints.length >= 2 &&
      el.source.type !== BPMN_BOUNDARY_EVENT
  );

  for (const conn of connections) {
    const src = conn.source!;
    const tgt = conn.target!;

    const srcCx = Math.round(src.x + (src.width || 0) / 2);
    const srcCy = Math.round(src.y + (src.height || 0) / 2);
    const srcBottom = src.y + (src.height || 0);
    const srcRight = src.x + (src.width || 0);
    const tgtCx = Math.round(tgt.x + (tgt.width || 0) / 2);
    const tgtCy = Math.round(tgt.y + (tgt.height || 0) / 2);
    const tgtBottom = tgt.y + (tgt.height || 0);
    const tgtLeft = tgt.x;

    // Only process backward flows: target is to the left of source
    // with a meaningful gap (>30px) to avoid touching near-collinear elements.
    if (tgtLeft >= srcRight - 30) continue;

    // Resolve the scope-specific bottom boundary for this connection.
    // In collaboration diagrams, use the participant's bottom to avoid
    // routing loopbacks below other pools.
    let scopeId = '__global__';
    let parent = src.parent;
    while (parent) {
      if (parent.type === 'bpmn:Participant') {
        scopeId = parent.id;
        break;
      }
      parent = parent.parent;
    }
    const maxBottom = scopeBottoms.get(scopeId) ?? globalBottom;
    const minTop = scopeTops.get(scopeId) ?? 0;

    // Skip connections that are already routed below the main path
    // (their waypoints go below the lowest element).
    const wps = conn.waypoints!;
    const currentMaxY = Math.max(...wps.map((wp: any) => wp.y));
    if (currentMaxY > maxBottom) continue;

    // E8: Choose routing direction based on the vertical relationship between
    // source and target:
    // - Target ABOVE source → route above the scope top (cleaner for up-and-back flows)
    // - Target at same level or below → route below (original behaviour)
    const routeAbove = tgtCy < srcCy - DIFFERENT_ROW_MIN_Y;

    const srcIsGateway = src.type?.includes('Gateway');
    let newWps: Array<{ x: number; y: number }>;

    if (routeAbove) {
      // Route above the topmost element in the scope
      const aboveY = Math.round(minTop - LOOPBACK_ABOVE_MARGIN);

      if (srcIsGateway) {
        // Gateway: exit from top edge (centre X), loop above, enter target top
        const srcTop = src.y;
        const tgtTop = tgt.y;
        newWps = [
          { x: srcCx, y: Math.round(srcTop) },
          { x: srcCx, y: aboveY },
          { x: tgtCx, y: aboveY },
          { x: tgtCx, y: Math.round(tgtTop) },
        ];
      } else {
        // Non-gateway: exit right edge, go up, left, down into target
        const exitX = Math.round(srcRight + LOOPBACK_HORIZONTAL_MARGIN);
        const entryX = Math.round(tgtLeft - LOOPBACK_HORIZONTAL_MARGIN);
        newWps = [
          { x: Math.round(srcRight), y: srcCy },
          { x: exitX, y: srcCy },
          { x: exitX, y: aboveY },
          { x: entryX, y: aboveY },
          { x: entryX, y: tgtCy },
          { x: Math.round(tgtLeft), y: tgtCy },
        ];
      }
    } else {
      // Route below the bottommost element in the scope (original behaviour)
      const belowY = Math.round(maxBottom + LOOPBACK_BELOW_MARGIN);

      if (srcIsGateway) {
        // Gateway: exit from bottom, go down, left, up into target
        newWps = [
          { x: srcCx, y: Math.round(srcBottom) },
          { x: srcCx, y: belowY },
          { x: tgtCx, y: belowY },
          { x: tgtCx, y: Math.round(tgtBottom) },
        ];
      } else {
        // Non-gateway: exit from right edge down, go left, up into target left
        const exitX = Math.round(srcRight + LOOPBACK_HORIZONTAL_MARGIN);
        const entryX = Math.round(tgtLeft - LOOPBACK_HORIZONTAL_MARGIN);
        newWps = [
          { x: Math.round(srcRight), y: srcCy },
          { x: exitX, y: srcCy },
          { x: exitX, y: belowY },
          { x: entryX, y: belowY },
          { x: entryX, y: tgtCy },
          { x: Math.round(tgtLeft), y: tgtCy },
        ];
      }
    }

    modeling.updateWaypoints(conn, deduplicateWaypoints(newWps));
  }
}

// ── E4: Parallel flow bundling ──────────────────────────────────────────────

/**
 * Vertical offset (px) per parallel flow when bundling.
 *
 * When two flows between the same source and target are spread, they are
 * offset from the route's natural Y by ± this amount (centred on the group).
 * 10 px is large enough to be visually distinct but small enough not to
 * disrupt neighbouring elements.
 */
const BUNDLE_OFFSET_PX = 10;

/**
 * E4: Bundle parallel flows between the same source → target pair.
 *
 * When multiple sequence flows connect exactly the same source and target
 * element (e.g. a conditional flow + a compensation flow, or two labelled
 * branches going to the same node), they are laid out at the same Y by the
 * ELK pipeline and are visually indistinguishable.
 *
 * This pass groups flows by (source.id, target.id).  For each group of
 * 2 or more flows it distributes them vertically by adjusting the Y
 * coordinate of their intermediate (non-endpoint) waypoints:
 *
 * ```
 *   flow 1 ──────────────────────────────────────→  (offset -10)
 *   flow 2 ──────────────────────────────────────→  (offset   0, default)
 *   flow 3 ──────────────────────────────────────→  (offset +10)
 * ```
 *
 * Only flows with ≥ 3 waypoints are offset (2-waypoint straight lines have
 * no safe intermediate point to shift without breaking connectivity).
 * Flows already separated by `separateOverlappingGatewayFlows` (which
 * routes the skip-ahead branch with a COLLINEAR_DETOUR_OFFSET detour) are
 * not touched — this function is complementary and handles flows between
 * the *same* source and target rather than between a shared source and
 * different targets.
 *
 * Should run after all other edge routing passes and before the final
 * orthogonal snap (`snapAllConnectionsOrthogonal`).
 */
export function bundleParallelFlows(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const BPMN_SEQUENCE_FLOW = 'bpmn:SequenceFlow';

  const connections = elementRegistry.filter(
    (el) =>
      el.type === BPMN_SEQUENCE_FLOW &&
      !!el.source &&
      !!el.target &&
      !!el.waypoints &&
      el.waypoints.length >= 2
  );

  // Group flows by canonical (source.id, target.id) key
  const groups = new Map<string, BpmnElement[]>();
  for (const conn of connections) {
    const key = `${conn.source!.id}::${conn.target!.id}`;
    const group = groups.get(key);
    if (group) {
      group.push(conn);
    } else {
      groups.set(key, [conn]);
    }
  }

  // Only process groups with 2+ flows
  for (const flows of groups.values()) {
    if (flows.length < 2) continue;

    const n = flows.length;

    for (let idx = 0; idx < n; idx++) {
      const conn = flows[idx];
      const wps = conn.waypoints!;

      // Skip 2-waypoint straight connections — no interior point to offset.
      if (wps.length < 3) continue;

      // Centred offset: for n flows, offsets are -(n-1)/2…+(n-1)/2 * BUNDLE_OFFSET_PX
      const offset = Math.round((idx - (n - 1) / 2) * BUNDLE_OFFSET_PX);
      if (offset === 0) continue; // No movement needed for the middle flow

      // Build updated waypoints: shift interior points' Y by `offset`.
      // Only shift waypoints that are on horizontal segments (|dy| < tolerance)
      // relative to their neighbours.  This moves the flat horizontal portion
      // of the route without breaking the vertical segments that connect to
      // element boundaries.
      const newWps = wps.map((wp) => ({ x: wp.x, y: wp.y }));
      let changed = false;

      for (let i = 1; i < newWps.length - 1; i++) {
        const prevY = newWps[i - 1].y;
        const currY = newWps[i].y;
        const nextY = newWps[i + 1].y;

        // This waypoint is on a horizontal run if the segment from its
        // predecessor OR to its successor is near-horizontal.
        const prevSegHoriz = Math.abs(currY - prevY) <= 3;
        const nextSegHoriz = Math.abs(currY - nextY) <= 3;

        if (prevSegHoriz || nextSegHoriz) {
          newWps[i] = { x: newWps[i].x, y: Math.round(currY + offset) };
          changed = true;
        }
      }

      if (changed) {
        modeling.updateWaypoints(conn, deduplicateWaypoints(newWps));
      }
    }
  }
}
