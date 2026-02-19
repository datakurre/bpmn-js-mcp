/**
 * Boundary exception chain identification and repositioning (J2 split from boundary-events.ts).
 *
 * Handles identifying which elements form boundary exception chains
 * (reachable only via boundary events), repositioning them below their
 * boundary event hosts, and aligning off-path end events.
 */

import {
  BPMN_TASK_HEIGHT,
  BPMN_EVENT_SIZE,
  BOUNDARY_TARGET_ROW_BUFFER,
  BOUNDARY_TARGET_Y_OFFSET,
  BOUNDARY_TARGET_X_OFFSET,
} from './constants';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { BPMN_BOUNDARY_EVENT_TYPE } from './boundary-save-restore';
import { detectCurrentBorder } from './boundary-positioning';

/** BPMN type string for sequence flows. */
const BPMN_SEQUENCE_FLOW = 'bpmn:SequenceFlow';

/** BPMN type string for message flows. */
const BPMN_MESSAGE_FLOW = 'bpmn:MessageFlow';

/** Gap (px) between consecutive chain elements (edge-to-edge). */
const BOUNDARY_CHAIN_GAP = 50;

/** Y-offset (px) per additional chain on the same host for stacking. */
const BOUNDARY_CHAIN_STACK_OFFSET = 120;

/**
 * Identify boundary exception chains: all nodes reachable only via
 * boundary events (no incoming from the happy path).
 *
 * Walks forward from each boundary event's outgoing target, collecting
 * the entire exception sub-chain.  A node is included if ALL of its
 * incoming connections come from boundary events or other chain nodes.
 *
 * These are excluded from the ELK graph to prevent proxy edges from
 * creating extra layers that distort horizontal spacing and cause
 * boundary flows to cross through unrelated elements.  They are
 * positioned manually after boundary events are placed.
 *
 * For fixture 08, this captures: SendReminder+EndReminder,
 * HandleSysError+EndSysError, LogCancel+EndCancel, EndAbort,
 * NotifyManager+EndEscalated.
 */
export function identifyBoundaryExceptionChains(
  allElements: BpmnElement[],
  container: BpmnElement
): Set<string> {
  const result = new Set<string>();

  const boundaryEventIds = new Set(
    allElements
      .filter((el) => el.parent === container && el.type === BPMN_BOUNDARY_EVENT_TYPE)
      .map((el) => el.id)
  );

  if (boundaryEventIds.size === 0) return result;

  const containerConnections = allElements.filter(
    (el) =>
      el.parent === container &&
      (el.type === BPMN_SEQUENCE_FLOW || el.type === BPMN_MESSAGE_FLOW) &&
      el.source &&
      el.target
  );

  // Build incoming adjacency: target ID → set of source IDs
  const incomingSources = new Map<string, Set<string>>();
  for (const conn of containerConnections) {
    const targetId = conn.target!.id;
    if (!incomingSources.has(targetId)) {
      incomingSources.set(targetId, new Set());
    }
    incomingSources.get(targetId)!.add(conn.source!.id);
  }

  // Build outgoing adjacency: source ID → set of target IDs
  const outgoingTargets = new Map<string, Set<string>>();
  for (const conn of containerConnections) {
    const sourceId = conn.source!.id;
    if (!outgoingTargets.has(sourceId)) {
      outgoingTargets.set(sourceId, new Set());
    }
    outgoingTargets.get(sourceId)!.add(conn.target!.id);
  }

  // Iteratively find all nodes reachable only from boundary events.
  // A node is in the exception chain if ALL its incoming connections
  // come from either boundary events or other chain nodes.
  let changed = true;
  while (changed) {
    changed = false;

    // Check direct targets of boundary events
    for (const beId of boundaryEventIds) {
      const targets = outgoingTargets.get(beId);
      if (!targets) continue;
      for (const targetId of targets) {
        if (result.has(targetId)) continue;
        const incoming = incomingSources.get(targetId);
        if (!incoming) continue;
        const allFromChainOrBoundary = [...incoming].every(
          (srcId) => boundaryEventIds.has(srcId) || result.has(srcId)
        );
        if (allFromChainOrBoundary) {
          result.add(targetId);
          changed = true;
        }
      }
    }

    // Check outgoing from chain nodes
    for (const chainId of result) {
      const targets = outgoingTargets.get(chainId);
      if (!targets) continue;
      for (const targetId of targets) {
        if (result.has(targetId)) continue;
        const incoming = incomingSources.get(targetId);
        if (!incoming) continue;
        const allFromChainOrBoundary = [...incoming].every(
          (srcId) => boundaryEventIds.has(srcId) || result.has(srcId)
        );
        if (allFromChainOrBoundary) {
          result.add(targetId);
          changed = true;
        }
      }
    }
  }

  // Recurse into compound containers (participants, expanded subprocesses)
  for (const el of allElements) {
    if (
      el.parent === container &&
      (el.type === 'bpmn:Participant' || el.type === 'bpmn:SubProcess') &&
      el.isExpanded !== false
    ) {
      const nested = identifyBoundaryExceptionChains(allElements, el);
      for (const id of nested) result.add(id);
    }
  }

  return result;
}

/**
 * Backwards-compatible alias for `identifyBoundaryExceptionChains`.
 * @deprecated Use `identifyBoundaryExceptionChains` instead.
 */
export const identifyBoundaryLeafTargets = identifyBoundaryExceptionChains;

/**
 * Reposition boundary exception chain elements below their host.
 *
 * After boundary events are placed at the host's bottom border, their
 * outgoing flow targets and subsequent chain elements should be positioned
 * below the host at a consistent offset.  This counteracts ELK's tendency
 * to place boundary targets on the same row as the happy path (or in
 * adjacent host columns, causing flow crossings).
 *
 * For each boundary event:
 * - First chain element: placed below host, centred on boundary event X + offset.
 * - Subsequent chain elements: placed to the right of the previous element
 *   with standard gap (~50px edge-to-edge).
 *
 * Hosts with multiple boundary events stack additional chains with +120px Y
 * offset per chain to avoid overlap.
 *
 * Only repositions elements in the given excludedIds set (those that
 * were excluded from the ELK graph).
 */
export function repositionBoundaryEventTargets(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  excludedIds: Set<string>
): void {
  if (excludedIds.size === 0) return;

  const boundaryEvents = elementRegistry.filter(
    (el) => el.type === BPMN_BOUNDARY_EVENT_TYPE && !!el.host
  );

  // Track per-host chain count for stacking multiple chains
  const hostChainCount = new Map<string, number>();

  // Build outgoing adjacency for chain walking
  const allElements: BpmnElement[] = elementRegistry.getAll();
  const outgoingAdj = new Map<string, BpmnElement[]>();
  for (const el of allElements) {
    if (
      (el.type === BPMN_SEQUENCE_FLOW || el.type === BPMN_MESSAGE_FLOW) &&
      el.source &&
      el.target
    ) {
      const list = outgoingAdj.get(el.source.id) || [];
      list.push(el);
      outgoingAdj.set(el.source.id, list);
    }
  }

  for (const be of boundaryEvents) {
    const host = be.host!;
    const outgoing: BpmnElement[] = be.outgoing || [];

    for (const flow of outgoing) {
      const target = flow.target;
      if (!target || !excludedIds.has(target.id)) continue;

      // Track stacking for hosts with multiple boundary events
      const chainIndex = hostChainCount.get(host.id) || 0;
      hostChainCount.set(host.id, chainIndex + 1);

      const hostBottom = host.y + (host.height || BPMN_TASK_HEIGHT);
      const beCx = be.x + (be.width || BPMN_EVENT_SIZE) / 2;
      const stackOffset = chainIndex * BOUNDARY_CHAIN_STACK_OFFSET;

      // Walk the chain: first target + all successors in the excluded set
      const chain = walkExceptionChain(target, excludedIds, outgoingAdj);

      let prevRight = 0;
      for (let i = 0; i < chain.length; i++) {
        const el = chain[i];
        const elW = el.width || BPMN_EVENT_SIZE;
        const elH = el.height || BPMN_EVENT_SIZE;

        let desiredCx: number;
        let desiredCy: number;

        if (i === 0) {
          // First element: below host, offset from boundary event
          desiredCx = beCx + BOUNDARY_TARGET_X_OFFSET;
          desiredCy = hostBottom + BOUNDARY_TARGET_Y_OFFSET + stackOffset;
        } else {
          // Subsequent elements: to the right of previous with standard gap
          desiredCx = prevRight + BOUNDARY_CHAIN_GAP + elW / 2;
          desiredCy = hostBottom + BOUNDARY_TARGET_Y_OFFSET + stackOffset;
        }

        const currentCx = el.x + elW / 2;
        const currentCy = el.y + elH / 2;

        const dx = Math.round(desiredCx - currentCx);
        const dy = Math.round(desiredCy - currentCy);

        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          modeling.moveElements([el], { x: dx, y: dy });
        }

        // Track right edge for next element positioning
        prevRight = el.x + elW;
      }
    }
  }
}

/**
 * Walk forward from a starting element along the exception chain,
 * collecting elements in the excluded set in sequence order.
 */
function walkExceptionChain(
  start: BpmnElement,
  excludedIds: Set<string>,
  outgoingAdj: Map<string, BpmnElement[]>
): BpmnElement[] {
  const chain: BpmnElement[] = [];
  const visited = new Set<string>();
  let current: BpmnElement | null = start;

  while (current && excludedIds.has(current.id) && !visited.has(current.id)) {
    visited.add(current.id);
    chain.push(current);

    // Find the next element in the chain (first outgoing target in excluded set)
    const flows: BpmnElement[] = outgoingAdj.get(current.id) || [];
    current = null;
    for (const flow of flows) {
      const tgt: BpmnElement | undefined = flow.target;
      if (tgt && excludedIds.has(tgt.id) && !visited.has(tgt.id)) {
        current = tgt;
        break;
      }
    }
  }

  return chain;
}

/**
 * Align off-path end events to the boundary target row.
 *
 * After boundary targets are positioned below the happy path, off-path
 * end events (e.g. gateway "No" branch targets) may sit between the
 * happy path and the boundary target row.  This function pushes them
 * down to the boundary target row for consistent visual alignment.
 *
 * Only moves end events that:
 * - Are NOT on the happy path
 * - Are NOT already positioned as boundary targets
 * - Are below the happy-path median Y but above the boundary target row
 */
export function alignOffPathEndEventsToSecondRow(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  excludedIds: Set<string>,
  happyPathEdgeIds?: Set<string>
): void {
  if (excludedIds.size === 0) return;

  // Find the boundary target row centre Y (maximum of repositioned targets)
  let belowRowCy = 0;
  for (const id of excludedIds) {
    const el = elementRegistry.get(id);
    if (!el) continue;
    const cy = el.y + (el.height || 36) / 2;
    if (cy > belowRowCy) belowRowCy = cy;
  }
  if (belowRowCy === 0) return;

  // Compute happy-path node IDs
  const happyPathNodeIds = new Set<string>();
  const allElements: BpmnElement[] = elementRegistry.getAll();
  if (happyPathEdgeIds && happyPathEdgeIds.size > 0) {
    for (const el of allElements) {
      if (
        (el.type === BPMN_SEQUENCE_FLOW || el.type === BPMN_MESSAGE_FLOW) &&
        happyPathEdgeIds.has(el.id)
      ) {
        if (el.source) happyPathNodeIds.add(el.source.id);
        if (el.target) happyPathNodeIds.add(el.target.id);
      }
    }
  }

  // Compute happy-path median Y-centre
  const happyShapes = allElements.filter(
    (el) => happyPathNodeIds.has(el.id) && el.width !== undefined
  );
  if (happyShapes.length === 0) return;
  const happyCentres = happyShapes.map((el) => el.y + (el.height || 0) / 2);
  happyCentres.sort((a: number, b: number) => a - b);
  const happyMedianCy = happyCentres[Math.floor(happyCentres.length / 2)];

  // Push qualifying off-path end events to the boundary target row
  for (const el of allElements) {
    if (el.type !== 'bpmn:EndEvent') continue;
    if (happyPathNodeIds.has(el.id)) continue;
    if (excludedIds.has(el.id)) continue;

    const cy = el.y + (el.height || BPMN_EVENT_SIZE) / 2;

    // Must be below the happy path but above the boundary target row
    if (
      cy > happyMedianCy + BOUNDARY_TARGET_ROW_BUFFER &&
      cy < belowRowCy - BOUNDARY_TARGET_ROW_BUFFER
    ) {
      const dy = Math.round(belowRowCy - cy);
      if (Math.abs(dy) > 2) {
        modeling.moveElements([el], { x: 0, y: dy });
      }
    }
  }
}

/**
 * Push boundary event targets that ELK placed above the happy path down
 * below it.
 *
 * When a boundary event sits on the bottom border of its host, its
 * exception flow should exit downward.  However, ELK's proxy edges
 * may place the target node above the happy path (e.g. in fixture 17,
 * "Fix Input Data" ends up at y=106 above the main path at y=148).
 *
 * This function detects such mis-placements and moves the entire
 * exception sub-flow (target + all successors not on the happy path)
 * below the happy-path row.  Only affects targets that are NOT already
 * handled by `repositionBoundaryEventTargets` (i.e. not in the
 * excludedIds set).
 */
export function pushBoundaryTargetsBelowHappyPath(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  excludedIds: Set<string>,
  happyPathEdgeIds?: Set<string>
): void {
  if (!happyPathEdgeIds || happyPathEdgeIds.size === 0) return;

  // Compute happy-path node IDs and median Y
  const happyPathNodeIds = new Set<string>();
  const allElements: BpmnElement[] = elementRegistry.getAll();
  for (const el of allElements) {
    if (
      (el.type === BPMN_SEQUENCE_FLOW || el.type === BPMN_MESSAGE_FLOW) &&
      happyPathEdgeIds.has(el.id)
    ) {
      if (el.source) happyPathNodeIds.add(el.source.id);
      if (el.target) happyPathNodeIds.add(el.target.id);
    }
  }

  const happyShapes = allElements.filter(
    (el) => happyPathNodeIds.has(el.id) && el.width !== undefined
  );
  if (happyShapes.length === 0) return;
  const happyCentres = happyShapes.map((el) => el.y + (el.height || 0) / 2);
  happyCentres.sort((a: number, b: number) => a - b);
  const happyMedianCy = happyCentres[Math.floor(happyCentres.length / 2)];

  // Build outgoing adjacency for walking exception chains
  const outgoingAdj = new Map<string, BpmnElement[]>();
  for (const el of allElements) {
    if (el.type === BPMN_SEQUENCE_FLOW && el.source && el.target) {
      const list = outgoingAdj.get(el.source.id) || [];
      list.push(el);
      outgoingAdj.set(el.source.id, list);
    }
  }

  // Find boundary events on the bottom border
  const boundaryEvents = elementRegistry.filter(
    (el) => el.type === BPMN_BOUNDARY_EVENT_TYPE && !!el.host
  );

  for (const be of boundaryEvents) {
    const host = be.host!;
    const border = detectCurrentBorder(be, host);
    if (border !== 'bottom') continue;

    const outgoing: BpmnElement[] = be.outgoing || [];
    for (const flow of outgoing) {
      const target = flow.target;
      if (!target || excludedIds.has(target.id)) continue;
      if (happyPathNodeIds.has(target.id)) continue;

      const targetCy = target.y + (target.height || 0) / 2;

      // Target is above or at the happy path — should be below
      if (targetCy < happyMedianCy + BOUNDARY_TARGET_ROW_BUFFER) {
        // Mirror below: push to same distance below as it is above
        const distAbove = happyMedianCy - targetCy;
        const desiredCy = happyMedianCy + distAbove + BOUNDARY_TARGET_Y_OFFSET;
        const dy = Math.round(desiredCy - targetCy);

        if (dy > 2) {
          // Collect the entire exception sub-flow chain (target + successors
          // not on the happy path) and move them all by the same delta.
          const chain = collectExceptionChain(target, happyPathNodeIds, outgoingAdj);
          for (const el of chain) {
            modeling.moveElements([el], { x: 0, y: dy });
          }
        }
      }
    }
  }
}

/**
 * Walk forward from a starting element, collecting all non-happy-path
 * successor nodes.  Stops at happy-path nodes or already-visited nodes.
 */
function collectExceptionChain(
  start: BpmnElement,
  happyPathNodeIds: Set<string>,
  outgoingAdj: Map<string, BpmnElement[]>
): BpmnElement[] {
  const result: BpmnElement[] = [];
  const visited = new Set<string>();
  const queue = [start];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    result.push(node);

    // Follow outgoing flows to non-happy-path successors
    const flows = outgoingAdj.get(node.id) || [];
    for (const flow of flows) {
      const next = flow.target;
      if (next && !happyPathNodeIds.has(next.id) && !visited.has(next.id)) {
        queue.push(next);
      }
    }
  }

  return result;
}
