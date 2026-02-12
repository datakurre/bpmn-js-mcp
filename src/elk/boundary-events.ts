/**
 * Post-layout boundary event repositioning.
 *
 * Boundary events are excluded from the ELK graph and should follow their
 * host when `modeling.moveElements` moves it.  In headless (jsdom) mode,
 * the automatic follow does not work correctly, leaving boundary events
 * stranded at their original positions.
 *
 * Additionally, headless mode can corrupt boundary event types — changing
 * them from `bpmn:BoundaryEvent` to `bpmn:IntermediateCatchEvent`.
 * The save/restore mechanism preserves boundary event identity across
 * layout operations.
 */

import {
  BPMN_TASK_WIDTH,
  BPMN_TASK_HEIGHT,
  BPMN_EVENT_SIZE,
  GATEWAY_UPPER_SPLIT_FACTOR,
  CENTER_FACTOR,
  BOUNDARY_TARGET_ROW_BUFFER,
  BOUNDARY_MIN_MOVE_DELTA,
  BOUNDARY_PROXIMITY_TOLERANCE,
  BOUNDARY_TARGET_Y_OFFSET,
  BOUNDARY_TARGET_X_OFFSET,
} from './constants';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';

/** BPMN type string for boundary events. */
const BPMN_BOUNDARY_EVENT_TYPE = 'bpmn:BoundaryEvent';

/** Snapshot of a boundary event's identity before layout. */
export interface BoundaryEventSnapshot {
  elementId: string;
  hostId: string;
}

/**
 * Save boundary event data before layout operations.
 *
 * Records each boundary event's ID and host ID so we can restore
 * the relationship after moves that may corrupt it in headless mode.
 */
export function saveBoundaryEventData(elementRegistry: ElementRegistry): BoundaryEventSnapshot[] {
  return elementRegistry
    .filter((el) => el.type === BPMN_BOUNDARY_EVENT_TYPE && !!el.host)
    .map((be) => ({
      elementId: be.id,
      hostId: be.host!.id,
    }));
}

/**
 * Restore boundary event types and host references after layout.
 *
 * In headless (jsdom) mode, `modeling.moveElements` can accidentally
 * change a `bpmn:BoundaryEvent` to `bpmn:IntermediateCatchEvent` and
 * lose the host attachment.  This function uses pre-layout snapshots
 * to repair the damage.
 */
export function restoreBoundaryEventData(
  elementRegistry: ElementRegistry,
  snapshots: BoundaryEventSnapshot[]
): void {
  for (const snap of snapshots) {
    const el = elementRegistry.get(snap.elementId);
    if (!el) continue;

    const host = elementRegistry.get(snap.hostId);
    if (!host) continue;

    // Restore shape type
    if (el.type !== BPMN_BOUNDARY_EVENT_TYPE) {
      el.type = BPMN_BOUNDARY_EVENT_TYPE;
    }

    // Restore business object type.
    // In bpmn-moddle, $type is a getter from $descriptor, so we use
    // Object.defineProperty to override it with an own property.
    const bo = el.businessObject;
    if (bo && bo.$type !== 'bpmn:BoundaryEvent') {
      try {
        Object.defineProperty(bo, '$type', {
          value: 'bpmn:BoundaryEvent',
          writable: true,
          enumerable: false,
          configurable: true,
        });
      } catch {
        // If we can't change $type, at least ensure the shape type is correct
      }
    }

    // Restore host reference on the shape
    if (!el.host || el.host.id !== snap.hostId) {
      el.host = host;
    }

    // Restore attachedToRef on the business object
    if (bo && host.businessObject) {
      bo.attachedToRef = host.businessObject;
    }
  }
}

/**
 * Determine the best border position for a boundary event based on its
 * outgoing flow targets relative to its host element.
 *
 * Defaults to 'bottom' following the BPMN convention that exception
 * flows exit downward.  Only chooses a different border when the target
 * is clearly in another direction.
 *
 * Returns 'bottom' (default), 'top', 'left', or 'right'.
 */
function chooseBoundaryBorder(
  be: BpmnElement,
  host: BpmnElement
): 'top' | 'bottom' | 'left' | 'right' {
  const outgoing: BpmnElement[] = be.outgoing || [];
  if (outgoing.length === 0) return 'bottom'; // default: no outgoing flows

  // Find the first target element with a valid position
  for (const flow of outgoing) {
    const target = flow.target;
    if (!target || target.x == null || target.y == null) continue;

    const hostCx = host.x + (host.width || BPMN_TASK_WIDTH) / 2;
    const hostCy = host.y + (host.height || BPMN_TASK_HEIGHT) / 2;
    const hostH = host.height || BPMN_TASK_HEIGHT;
    const targetCx = target.x + (target.width || BPMN_EVENT_SIZE) / 2;
    const targetCy = target.y + (target.height || BPMN_EVENT_SIZE) / 2;

    const dx = targetCx - hostCx;
    const dy = targetCy - hostCy;

    // Default to bottom (BPMN convention: exception flows go downward).
    // Only choose another border when the target is clearly in that
    // direction:
    //   - 'top' only if target is clearly above the host
    //   - 'right' only if target is significantly to the right AND on the
    //     same row (|dy| < host height)
    //   - 'left' only if target is to the left (backward loop)
    if (dy < -hostH / 2 && Math.abs(dy) > Math.abs(dx)) {
      return 'top';
    }
    if (dx < 0 && Math.abs(dx) > Math.abs(dy)) {
      return 'left';
    }
    // BPMN convention: exception flows exit downward from the bottom border.
    // Do not pick 'right' — ELK proxy edges place targets on the same row
    // as the host, which would incorrectly trigger a 'right' border choice.
    return 'bottom'; // default: exception flows exit downward
  }

  return 'bottom'; // fallback
}

/**
 * Compute the target centre position for a boundary event on a given
 * border of its host element.
 */
function computeBoundaryPosition(
  host: BpmnElement,
  border: 'top' | 'bottom' | 'left' | 'right'
): { cx: number; cy: number } {
  const hostW = host.width || BPMN_TASK_WIDTH;
  const hostH = host.height || BPMN_TASK_HEIGHT;

  switch (border) {
    case 'top':
      return { cx: host.x + hostW * GATEWAY_UPPER_SPLIT_FACTOR, cy: host.y };
    case 'bottom':
      return { cx: host.x + hostW * CENTER_FACTOR, cy: host.y + hostH };
    case 'left':
      return { cx: host.x, cy: host.y + hostH * GATEWAY_UPPER_SPLIT_FACTOR };
    case 'right':
      return { cx: host.x + hostW, cy: host.y + hostH * GATEWAY_UPPER_SPLIT_FACTOR };
  }
}

/**
 * Fix boundary event positions after layout.
 *
 * When repositioning is needed, the target border (top, bottom, left,
 * right) is chosen based on the direction of the boundary event's
 * outgoing flow targets. This positions error/timer boundary events on
 * the border closest to where their exception flow leads.
 *
 * Multiple boundary events on the same host are spread horizontally
 * to avoid overlap.
 *
 * Accepts optional pre-layout snapshots to find boundary events whose
 * type may have been corrupted during layout (headless mode can change
 * `bpmn:BoundaryEvent` to `bpmn:IntermediateCatchEvent`).
 *
 * When called with snapshots (after a full layout), always repositions
 * boundary events to the optimal border — layout operations move all
 * elements so boundary events need recalculation regardless of proximity.
 */
export function repositionBoundaryEvents(
  elementRegistry: ElementRegistry,
  _modeling: Modeling,
  snapshots?: BoundaryEventSnapshot[]
): void {
  // When snapshots are provided, we're running after a full layout and
  // should always reposition boundary events to the correct border.
  const forceReposition = snapshots !== undefined && snapshots.length > 0;

  // Find boundary events: prefer type-based filter, but also check
  // snapshots for elements whose type was corrupted.
  const byType = elementRegistry.filter((el) => el.type === BPMN_BOUNDARY_EVENT_TYPE);
  const foundIds = new Set(byType.map((el) => el.id));
  const boundaryEvents: BpmnElement[] = [...byType];

  // Also find boundary events from snapshots that weren't found by type
  if (snapshots) {
    for (const snap of snapshots) {
      if (!foundIds.has(snap.elementId)) {
        const el = elementRegistry.get(snap.elementId);
        if (el) {
          boundaryEvents.push(el);
          foundIds.add(snap.elementId);
        }
      }
    }
  }

  // Ensure boundary events retain their correct type (headless mode can
  // accidentally change types during bulk moves)
  for (const be of boundaryEvents) {
    if (be.type !== BPMN_BOUNDARY_EVENT_TYPE) {
      be.type = BPMN_BOUNDARY_EVENT_TYPE;
    }
    const bo = be.businessObject;
    if (bo && bo.$type !== BPMN_BOUNDARY_EVENT_TYPE) {
      try {
        Object.defineProperty(bo, '$type', {
          value: BPMN_BOUNDARY_EVENT_TYPE,
          writable: true,
          enumerable: false,
          configurable: true,
        });
      } catch {
        // $type is a getter in bpmn-moddle — skip if immutable
      }
    }
  }

  for (const be of boundaryEvents) {
    const host = be.host;
    if (!host) continue;

    const beW = be.width || BPMN_EVENT_SIZE;
    const beH = be.height || BPMN_EVENT_SIZE;
    const beCx = be.x + beW / 2;
    const beCy = be.y + beH / 2;

    // After a full layout, always reposition to the optimal border.
    // Otherwise, only reposition if the boundary event is far from its host.
    let needsReposition = forceReposition;

    if (!needsReposition) {
      const hostRight = host.x + (host.width || BPMN_TASK_WIDTH);
      const hostBottom = host.y + (host.height || BPMN_TASK_HEIGHT);
      const tolerance = BOUNDARY_PROXIMITY_TOLERANCE;

      needsReposition = !(
        beCx >= host.x - tolerance &&
        beCx <= hostRight + tolerance &&
        beCy >= host.y - tolerance &&
        beCy <= hostBottom + tolerance
      );
    }

    if (needsReposition) {
      // Choose border based on outgoing flow direction
      const border = chooseBoundaryBorder(be, host);
      const target = computeBoundaryPosition(host, border);
      const dx = target.cx - beCx;
      const dy = target.cy - beCy;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        // Directly update position — using modeling.moveElements on boundary
        // events triggers DetachEventBehavior in headless/jsdom mode, which
        // tries to replace them with IntermediateCatchEvents and crashes on
        // SVG path intersection calculations (null path data in jsdom).
        be.x += dx;
        be.y += dy;
        const di = be.di;
        if (di?.bounds) {
          di.bounds.x = be.x;
          di.bounds.y = be.y;
        }

        // Move the label by the same delta so it stays near the event
        // (direct manipulation doesn't update child shapes automatically).
        if (be.label) {
          be.label.x += dx;
          be.label.y += dy;
        }
        // Also update the label DI bounds to keep BPMN XML consistent
        if (di?.label?.bounds) {
          di.label.bounds.x += dx;
          di.label.bounds.y += dy;
        }
      }
    }
  }

  // ── Spread multiple boundary events sharing the same host border ──
  // Group boundary events by host, then detect events on the same border.
  // When multiple events share a border, spread them evenly along that
  // edge to prevent overlap.
  spreadBoundaryEventsOnSameBorder(boundaryEvents);
}

// ── Boundary event target repositioning ────────────────────────────────────

/**
 * Identify boundary-only leaf targets: end events whose only incoming
 * connection is from a boundary event.  These are excluded from the ELK
 * graph to prevent proxy edges from creating extra layers that distort
 * horizontal spacing.  They are positioned manually after boundary events
 * are placed.
 */
export function identifyBoundaryLeafTargets(
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
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.source &&
      el.target
  );

  for (const conn of containerConnections) {
    if (!boundaryEventIds.has(conn.source!.id)) continue;
    const target = conn.target;
    if (!target || target.type !== 'bpmn:EndEvent') continue;

    // Check if this end event has any incoming from a non-boundary source
    const hasNonBoundaryIncoming = containerConnections.some(
      (c) => c.target!.id === target.id && !boundaryEventIds.has(c.source!.id)
    );
    if (!hasNonBoundaryIncoming) {
      result.add(target.id);
    }
  }

  // Recurse into compound containers (participants, expanded subprocesses)
  for (const el of allElements) {
    if (
      el.parent === container &&
      (el.type === 'bpmn:Participant' || el.type === 'bpmn:SubProcess') &&
      el.isExpanded !== false
    ) {
      const nested = identifyBoundaryLeafTargets(allElements, el);
      for (const id of nested) result.add(id);
    }
  }

  return result;
}

/**
 * Reposition direct leaf targets of boundary events below the host.
 *
 * After boundary events are placed at the host's bottom border, their
 * outgoing flow targets (end events) should be positioned below the
 * host at a consistent offset.  This counteracts ELK's tendency to
 * place boundary targets on the same row as the happy path.
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

  for (const be of boundaryEvents) {
    const host = be.host!;
    const outgoing: BpmnElement[] = be.outgoing || [];

    for (const flow of outgoing) {
      const target = flow.target;
      if (!target || !excludedIds.has(target.id)) continue;

      const hostBottom = host.y + (host.height || BPMN_TASK_HEIGHT);
      const beCx = be.x + (be.width || BPMN_EVENT_SIZE) / 2;
      const targetW = target.width || BPMN_EVENT_SIZE;
      const targetH = target.height || BPMN_EVENT_SIZE;

      // Target centre: below host bottom + offset, to the right of boundary
      const desiredCx = beCx + BOUNDARY_TARGET_X_OFFSET;
      const desiredCy = hostBottom + BOUNDARY_TARGET_Y_OFFSET;

      const currentCx = target.x + targetW / 2;
      const currentCy = target.y + targetH / 2;

      const dx = Math.round(desiredCx - currentCx);
      const dy = Math.round(desiredCy - currentCy);

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        modeling.moveElements([target], { x: dx, y: dy });
      }
    }
  }
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
        (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
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
 * Detect which border a boundary event currently sits on relative to its host.
 * Returns 'top', 'bottom', 'left', or 'right' based on proximity.
 */
function detectCurrentBorder(
  be: BpmnElement,
  host: BpmnElement
): 'top' | 'bottom' | 'left' | 'right' {
  const beW = be.width || BPMN_EVENT_SIZE;
  const beH = be.height || BPMN_EVENT_SIZE;
  const beCy = be.y + beH / 2;
  const beCx = be.x + beW / 2;

  const hostTop = host.y;
  const hostBottom = host.y + (host.height || BPMN_TASK_HEIGHT);
  const hostLeft = host.x;
  const hostRight = host.x + (host.width || BPMN_TASK_WIDTH);

  // Find which border is closest to the event centre
  const dTop = Math.abs(beCy - hostTop);
  const dBottom = Math.abs(beCy - hostBottom);
  const dLeft = Math.abs(beCx - hostLeft);
  const dRight = Math.abs(beCx - hostRight);

  const minD = Math.min(dTop, dBottom, dLeft, dRight);
  if (minD === dBottom) return 'bottom';
  if (minD === dTop) return 'top';
  if (minD === dRight) return 'right';
  return 'left';
}

/**
 * Spread multiple boundary events that share the same border of a host.
 *
 * For 'top' and 'bottom' borders, events are spread along the X axis.
 * For 'left' and 'right' borders, events are spread along the Y axis.
 * Events are distributed evenly within the middle 80% of the border
 * to avoid crowding the corners.
 */
function spreadBoundaryEventsOnSameBorder(boundaryEvents: BpmnElement[]): void {
  // Group by (host ID, border)
  const groups = new Map<string, BpmnElement[]>();
  for (const be of boundaryEvents) {
    if (!be.host) continue;
    const border = detectCurrentBorder(be, be.host);
    const key = `${be.host!.id}:${border}`;
    const group = groups.get(key) || [];
    group.push(be);
    groups.set(key, group);
  }

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    const border = key.split(':').pop() as 'top' | 'bottom' | 'left' | 'right';
    const host = group[0].host!;
    const hostW = host.width || BPMN_TASK_WIDTH;
    const hostH = host.height || BPMN_TASK_HEIGHT;

    if (border === 'top' || border === 'bottom') {
      // Spread along X axis — use the middle 80% of the host width
      const margin = hostW * BOUNDARY_MIN_MOVE_DELTA;
      const availableWidth = hostW - 2 * margin;
      const step = group.length > 1 ? availableWidth / (group.length - 1) : 0;

      // Sort by current X to maintain relative order
      group.sort((a, b) => a.x - b.x);

      for (let i = 0; i < group.length; i++) {
        const be = group[i];
        const beW = be.width || BPMN_EVENT_SIZE;
        const targetCx = host.x + margin + (group.length > 1 ? i * step : availableWidth / 2);
        const dx = targetCx - (be.x + beW / 2);

        if (Math.abs(dx) > 1) {
          be.x += dx;
          if (be.di?.bounds) be.di.bounds.x = be.x;
          if (be.label) be.label.x += dx;
          if (be.di?.label?.bounds) be.di.label.bounds.x += dx;
        }
      }
    } else {
      // Spread along Y axis — use the middle 80% of the host height
      const margin = hostH * BOUNDARY_MIN_MOVE_DELTA;
      const availableHeight = hostH - 2 * margin;
      const step = group.length > 1 ? availableHeight / (group.length - 1) : 0;

      // Sort by current Y to maintain relative order
      group.sort((a, b) => a.y - b.y);

      for (let i = 0; i < group.length; i++) {
        const be = group[i];
        const beH = be.height || BPMN_EVENT_SIZE;
        const targetCy = host.y + margin + (group.length > 1 ? i * step : availableHeight / 2);
        const dy = targetCy - (be.y + beH / 2);

        if (Math.abs(dy) > 1) {
          be.y += dy;
          if (be.di?.bounds) be.di.bounds.y = be.y;
          if (be.label) be.label.y += dy;
          if (be.di?.label?.bounds) be.di.label.bounds.y += dy;
        }
      }
    }
  }
}
