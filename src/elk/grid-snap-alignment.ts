/**
 * Post-ELK grid snap — alignment helpers.
 *
 * Functions for centering gateways, symmetrising branches,
 * and aligning happy-path / off-path elements after grid snapping.
 */

import { ELK_NODE_SPACING } from '../constants';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { isConnection, isInfrastructure, isArtifact, isLayoutableShape } from './helpers';
import {
  MAX_WOBBLE_CORRECTION,
  MAX_EXTENDED_CORRECTION,
  COLUMN_PROXIMITY,
  SAME_LAYER_X_THRESHOLD,
  MIN_MOVE_THRESHOLD,
} from './constants';

/**
 * After grid snapping, re-centre gateways vertically to the midpoint
 * of their connected elements.  This matches bpmn-auto-layout's behaviour
 * where split/join gateways sit at the visual centre of their branches.
 *
 * Skips gateways on the happy path to avoid breaking row alignment.
 */
export function centreGatewaysOnBranches(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  happyPathNodeIds: Set<string>
): void {
  const gateways = elementRegistry.filter((el) => el.type?.includes('Gateway'));

  for (const gw of gateways) {
    // Skip gateways on the happy path to preserve row alignment
    if (happyPathNodeIds.has(gw.id)) continue;

    // Collect all directly connected elements (via outgoing + incoming flows)
    const connectedYs: number[] = [];
    const allElements: BpmnElement[] = elementRegistry.getAll();

    for (const el of allElements) {
      if (!isConnection(el.type)) continue;
      if (el.source?.id === gw.id && el.target) {
        connectedYs.push(el.target.y + (el.target.height || 0) / 2);
      }
      if (el.target?.id === gw.id && el.source) {
        connectedYs.push(el.source.y + (el.source.height || 0) / 2);
      }
    }

    if (connectedYs.length < 2) continue;

    const minY = Math.min(...connectedYs);
    const maxY = Math.max(...connectedYs);
    const midY = (minY + maxY) / 2;
    const gwCy = gw.y + (gw.height || 0) / 2;

    const dy = Math.round(midY - gwCy);
    if (Math.abs(dy) > MIN_MOVE_THRESHOLD) {
      modeling.moveElements([gw], { x: 0, y: dy });
    }
  }
}

/**
 * Symmetrise gateway branches around the happy-path centre line.
 *
 * For split gateways on the happy path with exactly 2 branch targets
 * in the same layer (both tasks, one happy-path and one off-path),
 * redistributes them symmetrically around the gateway's centre Y.
 *
 * Also handles off-path end events: positions them at the same Y as
 * their incoming branch element to avoid long vertical connectors
 * that make them appear disconnected.
 */
export function symmetriseGatewayBranches(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  happyPathNodeIds: Set<string>
): void {
  const allElements: BpmnElement[] = elementRegistry.getAll();
  const nodeSpacing = ELK_NODE_SPACING;

  // Find split gateways on the happy path (≥2 outgoing flows)
  const splitGateways = allElements.filter((el) => {
    if (!el.type?.includes('Gateway')) return false;
    if (!happyPathNodeIds.has(el.id)) return false;
    const outCount = allElements.filter(
      (conn) => isConnection(conn.type) && conn.source?.id === el.id
    ).length;
    return outCount >= 2;
  });

  for (const gw of splitGateways) {
    const gwCy = gw.y + (gw.height || 0) / 2;

    // Find outgoing connections and their non-gateway, non-event targets
    // (i.e. the branch task targets, excluding merge gateways / end events)
    const outgoing = allElements.filter(
      (conn) => isConnection(conn.type) && conn.source?.id === gw.id && !!conn.target
    );

    // Collect ALL branch targets (both on-path and off-path)
    const branchTargets = outgoing
      .map((conn) => conn.target)
      .filter(
        (t): t is BpmnElement => !!t && t.type !== 'bpmn:EndEvent' && !t.type?.includes('Gateway')
      );

    // For 2-branch patterns with tasks, symmetrise around the gateway Y.
    // When one branch is on the happy path, pin it at the gateway row and
    // push the off-path branch below — this matches the BPMN convention
    // where the "normal" flow goes straight and exceptions descend.
    if (branchTargets.length === 2) {
      const [t1, t2] = branchTargets;
      const t1Cy = t1.y + (t1.height || 0) / 2;
      const t2Cy = t2.y + (t2.height || 0) / 2;

      // Check if the two targets are roughly in the same layer (similar X)
      const t1Cx = t1.x + (t1.width || 0) / 2;
      const t2Cx = t2.x + (t2.width || 0) / 2;
      if (Math.abs(t1Cx - t2Cx) > SAME_LAYER_X_THRESHOLD) continue; // Different layers, skip

      const t1OnPath = happyPathNodeIds.has(t1.id);
      const t2OnPath = happyPathNodeIds.has(t2.id);

      if (t1OnPath !== t2OnPath) {
        // One on-path, one off-path: pin the on-path target at the gateway
        // row and move the off-path target below.
        const onPath = t1OnPath ? t1 : t2;
        const offPath = t1OnPath ? t2 : t1;

        // Pin on-path target to gateway Y
        const onPathCy = onPath.y + (onPath.height || 0) / 2;
        const dyOn = Math.round(gwCy - onPathCy);
        if (Math.abs(dyOn) > MIN_MOVE_THRESHOLD) {
          modeling.moveElements([onPath], { x: 0, y: dyOn });
        }

        // Move off-path target below the gateway row
        const offPathH = offPath.height || 0;
        const onPathH = onPath.height || 0;
        const desiredOffCy = gwCy + Math.max(onPathH, offPathH) / 2 + nodeSpacing;
        const offPathCy = offPath.y + offPathH / 2;
        const dyOff = Math.round(desiredOffCy - offPathCy);
        if (Math.abs(dyOff) > MIN_MOVE_THRESHOLD) {
          modeling.moveElements([offPath], { x: 0, y: dyOff });
        }
      } else {
        // Both on-path or both off-path: symmetric distribution
        const totalSpan = Math.abs(t1Cy - t2Cy);
        const idealSpan = Math.max(
          totalSpan,
          nodeSpacing + Math.max(t1.height || 0, t2.height || 0)
        );
        const halfSpan = idealSpan / 2;

        // Sort by current Y to determine which goes above/below
        const [upper, lower] = t1Cy < t2Cy ? [t1, t2] : [t2, t1];

        const upperDesiredCy = gwCy - halfSpan;
        const lowerDesiredCy = gwCy + halfSpan;

        const upperCy = upper.y + (upper.height || 0) / 2;
        const lowerCy = lower.y + (lower.height || 0) / 2;

        const dyUpper = Math.round(upperDesiredCy - upperCy);
        const dyLower = Math.round(lowerDesiredCy - lowerCy);

        if (Math.abs(dyUpper) > MIN_MOVE_THRESHOLD) {
          modeling.moveElements([upper], { x: 0, y: dyUpper });
        }
        if (Math.abs(dyLower) > MIN_MOVE_THRESHOLD) {
          modeling.moveElements([lower], { x: 0, y: dyLower });
        }
      }
    }

    // ── Off-path target handling ──
    const offPathTargets = outgoing
      .map((conn) => conn.target)
      .filter((t): t is BpmnElement => !!t && !happyPathNodeIds.has(t.id));

    // Move off-path end events to the same Y as their immediate
    // predecessor to avoid long vertical connectors.
    for (const target of offPathTargets) {
      if (target.type !== 'bpmn:EndEvent') continue;

      // Find incoming connection to this end event
      const incoming = allElements.find(
        (conn) => isConnection(conn.type) && conn.target?.id === target.id && conn.source
      );
      if (!incoming) continue;

      const sourceCy = incoming.source!.y + (incoming.source!.height || 0) / 2;
      const targetCy = target.y + (target.height || 0) / 2;
      const dy = Math.round(sourceCy - targetCy);
      if (Math.abs(dy) > MIN_MOVE_THRESHOLD) {
        modeling.moveElements([target], { x: 0, y: dy });
      }
    }
  }
}

/**
 * Align end events that are reachable from boundary event flows.
 *
 * Boundary events spawn exception sub-flows that often end with an
 * EndEvent.  Without explicit alignment, these end events can float
 * between the happy path and the lower branch instead of forming a
 * clean visual row.
 *
 * For each end event not already aligned with its predecessor,
 * snaps it to the Y-centre of the element that feeds into it.
 * This matches the pattern that `symmetriseGatewayBranches()` uses
 * for gateway-connected end events.
 */
export function alignBoundarySubFlowEndEvents(
  elementRegistry: ElementRegistry,
  modeling: Modeling
): void {
  const allElements: BpmnElement[] = elementRegistry.getAll();

  // Find boundary events with outgoing flows
  const boundaryEvents = allElements.filter(
    (el) => el.type === 'bpmn:BoundaryEvent' && !!(el.outgoing?.length && el.outgoing.length > 0)
  );

  for (const be of boundaryEvents) {
    // Trace forward from the boundary event, following outgoing flows
    // until we find end events
    const visited = new Set<string>();
    const queue: BpmnElement[] = [be];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);

      // Find outgoing connections from this element
      const outgoing = allElements.filter(
        (conn) => isConnection(conn.type) && conn.source?.id === current.id && conn.target
      );

      for (const conn of outgoing) {
        const target = conn.target;
        if (!target) continue;

        if (target.type === 'bpmn:EndEvent') {
          // Align the end event's Y-centre with its incoming source's Y-centre
          const sourceCy = current.y + (current.height || 0) / 2;
          const targetCy = target.y + (target.height || 0) / 2;
          const dy = Math.round(sourceCy - targetCy);
          if (Math.abs(dy) > MIN_MOVE_THRESHOLD) {
            modeling.moveElements([target], { x: 0, y: dy });
          }
        } else if (!visited.has(target.id)) {
          // Continue tracing through intermediate elements
          queue.push(target);
        }
      }
    }
  }
}

/**
 * Align off-path end events with their incoming source element.
 *
 * End events not on the happy path (e.g. "Order Rejected" on a rejection
 * branch) should sit at the same Y-centre as the element that feeds into
 * them, producing a clean horizontal sub-flow.
 *
 * This is a more general version of the off-path end-event handling in
 * `symmetriseGatewayBranches` (which only covers direct gateway targets)
 * and `alignBoundarySubFlowEndEvents` (which only traces from boundary
 * events).  The `Math.abs(dy) > MIN_MOVE_THRESHOLD` guard prevents double-moves for end
 * events already aligned by those earlier passes.
 */
export function alignOffPathEndEvents(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  happyPathEdgeIds?: Set<string>,
  container?: BpmnElement
): void {
  // Compute happy-path node IDs from edge IDs
  const happyPathNodeIds = new Set<string>();
  const allElements: BpmnElement[] = elementRegistry.getAll();
  if (happyPathEdgeIds && happyPathEdgeIds.size > 0) {
    for (const el of allElements) {
      if (isConnection(el.type) && happyPathEdgeIds.has(el.id)) {
        if (el.source) happyPathNodeIds.add(el.source.id);
        if (el.target) happyPathNodeIds.add(el.target.id);
      }
    }
  }

  // Scope to container if provided
  let parentFilter: BpmnElement | undefined = container;
  if (!parentFilter) {
    parentFilter = elementRegistry.filter(
      (el) => el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration'
    )[0];
  }

  for (const el of allElements) {
    if (el.type !== 'bpmn:EndEvent') continue;
    if (happyPathNodeIds.has(el.id)) continue;
    if (parentFilter && el.parent !== parentFilter) continue;

    // Find incoming connection
    const incoming = allElements.find(
      (conn) => isConnection(conn.type) && conn.target?.id === el.id && conn.source
    );
    if (!incoming) continue;

    const sourceCy = incoming.source!.y + (incoming.source!.height || 0) / 2;
    const targetCy = el.y + (el.height || 0) / 2;
    const dy = Math.round(sourceCy - targetCy);

    // Skip if incoming source is a split gateway — the end event is on a
    // downward branch and should stay on its ELK-assigned row.
    const isSourceBoundaryEvent = incoming.source!.type === 'bpmn:BoundaryEvent';
    const sourceOutgoing: BpmnElement[] = incoming.source!.outgoing || [];
    const isSourceSplitGateway =
      incoming.source!.type?.includes('Gateway') && sourceOutgoing.length >= 2;
    if (isSourceBoundaryEvent || isSourceSplitGateway) continue;

    if (Math.abs(dy) > MIN_MOVE_THRESHOLD) {
      modeling.moveElements([el], { x: 0, y: dy });
    }
  }
}

/**
 * Align all happy-path elements to a single Y-centre.
 *
 * After gridSnapPass, elements on the detected happy path may have small
 * Y-centre offsets (5–15 px) caused by ELK's gateway port placement and
 * node-size rounding.  This pass computes the median Y-centre of all
 * happy-path elements and snaps them to it, producing a perfectly
 * straight main flow line.
 *
 * Only corrects small wobbles (≤ MAX_WOBBLE_CORRECTION px).  Elements
 * that are far from the median are likely on separate branches of a
 * split/join pattern and should NOT be moved.
 *
 * Must run AFTER gridSnapPass (which may introduce the wobble) and
 * BEFORE edge routing (so waypoints reflect final positions).
 */
export function alignHappyPath(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  happyPathEdgeIds?: Set<string>,
  container?: BpmnElement,
  hasDiverseY?: boolean
): void {
  if (!happyPathEdgeIds || happyPathEdgeIds.size === 0) return;

  // Determine which container to scope to
  let parentFilter: BpmnElement | undefined = container;
  if (!parentFilter) {
    parentFilter = elementRegistry.filter(
      (el) => el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration'
    )[0];
  }

  // Collect happy-path node IDs from the edge set
  const happyPathNodeIds = new Set<string>();
  const allElements: BpmnElement[] = elementRegistry.getAll();
  for (const el of allElements) {
    if (isConnection(el.type) && happyPathEdgeIds.has(el.id)) {
      if (el.source) happyPathNodeIds.add(el.source.id);
      if (el.target) happyPathNodeIds.add(el.target.id);
    }
  }

  if (happyPathNodeIds.size < 2) return;

  // Get the actual shape objects for happy-path nodes that are direct
  // children of the target container (don't mix nesting levels)
  const happyShapes = allElements.filter(
    (el) =>
      happyPathNodeIds.has(el.id) &&
      !isConnection(el.type) &&
      !isInfrastructure(el.type) &&
      !isArtifact(el.type) &&
      el.type !== 'bpmn:BoundaryEvent' &&
      el.type !== 'label' &&
      el.type !== 'bpmn:Participant' &&
      (!parentFilter || el.parent === parentFilter)
  );

  if (happyShapes.length < 2) return;

  // Compute Y-centres
  const yCentres = happyShapes.map((el) => el.y + (el.height || 0) / 2);
  yCentres.sort((a: number, b: number) => a - b);

  // Use the median Y-centre as the alignment target
  const medianY = yCentres[Math.floor(yCentres.length / 2)];

  // Count how many elements are already close to the median (within wobble threshold).
  // If the majority agrees AND the diagram was imported with DI coordinates
  // (hasDiverseY), extend the correction threshold for outlier elements
  // (e.g. join gateways pulled away by fork-join patterns).
  // For programmatically created diagrams, keep the conservative threshold
  // to avoid pulling genuine off-path elements to the happy-path row.
  const nearMedianCount = yCentres.filter(
    (y) => Math.abs(y - medianY) <= MAX_WOBBLE_CORRECTION
  ).length;
  const majorityAgrees = nearMedianCount > yCentres.length / 2;

  let targetY = medianY;
  let effectiveThreshold: number;

  if (majorityAgrees && hasDiverseY) {
    // Majority agrees on median → extend threshold for outliers
    effectiveThreshold = MAX_EXTENDED_CORRECTION;
  } else if (hasDiverseY) {
    // No majority at median — synthetic edges or fork-join patterns may
    // have split happy-path elements across multiple Y levels.  Find the
    // Y-centre that has the most nearby elements (within wobble threshold)
    // to use as the alignment target.
    // Tiebreaker: topmost (smallest Y) to match BPMN convention where
    // the happy path is the topmost row and exceptions descend.
    let bestCount = nearMedianCount;
    let bestY = medianY;
    for (const candidateY of yCentres) {
      const count = yCentres.filter(
        (y) => Math.abs(y - candidateY) <= MAX_WOBBLE_CORRECTION
      ).length;
      if (count > bestCount || (count === bestCount && candidateY < bestY)) {
        bestCount = count;
        bestY = candidateY;
      }
    }
    targetY = bestY;
    effectiveThreshold = MAX_EXTENDED_CORRECTION;
  } else {
    effectiveThreshold = MAX_WOBBLE_CORRECTION;
  }

  // Snap only happy-path elements that are within the effective threshold
  // of the target Y.  Elements further away are on split/join branches
  // and should keep their gridSnap-assigned Y.
  //
  // Also move non-happy-path elements that share the same column (within
  // 30px X-centre) by the same delta.  Without this, gridSnap's vertical
  // distribution places non-happy elements relative to the pre-alignment
  // happy-path position, creating inconsistent Y gaps after alignment.
  const columnThreshold = COLUMN_PROXIMITY; // X-centre proximity to consider same column
  const nonHappyShapes = allElements.filter(
    (el) =>
      !happyPathNodeIds.has(el.id) &&
      isLayoutableShape(el) &&
      (!parentFilter || el.parent === parentFilter)
  );

  for (const el of happyShapes) {
    const cy = el.y + (el.height || 0) / 2;
    const dy = Math.round(targetY - cy);
    if (Math.abs(dy) > 0.5 && Math.abs(dy) <= effectiveThreshold) {
      modeling.moveElements([el], { x: 0, y: dy });

      // Move non-happy column-mates by the same delta to preserve
      // the relative vertical distribution within the column.
      // Exclude end events — they follow their predecessor's Y via
      // alignOffPathEndEvents, not their column's happy-path element.
      const elCx = el.x + (el.width || 0) / 2;
      const columnMates = nonHappyShapes.filter(
        (f) =>
          Math.abs(f.x + (f.width || 0) / 2 - elCx) < columnThreshold &&
          !f.type?.includes('EndEvent')
      );
      for (const mate of columnMates) {
        modeling.moveElements([mate], { x: 0, y: dy });
      }
    }
  }
}
