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
export function saveBoundaryEventData(elementRegistry: any): BoundaryEventSnapshot[] {
  return elementRegistry
    .filter((el: any) => el.type === 'bpmn:BoundaryEvent' && el.host)
    .map((be: any) => ({
      elementId: be.id,
      hostId: be.host.id,
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
  elementRegistry: any,
  snapshots: BoundaryEventSnapshot[]
): void {
  for (const snap of snapshots) {
    const el = elementRegistry.get(snap.elementId);
    if (!el) continue;

    const host = elementRegistry.get(snap.hostId);
    if (!host) continue;

    // Restore shape type
    if (el.type !== 'bpmn:BoundaryEvent') {
      el.type = 'bpmn:BoundaryEvent';
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
function chooseBoundaryBorder(be: any, host: any): 'top' | 'bottom' | 'left' | 'right' {
  const outgoing: any[] = be.outgoing || [];
  if (outgoing.length === 0) return 'bottom'; // default: no outgoing flows

  // Find the first target element with a valid position
  for (const flow of outgoing) {
    const target = flow.target;
    if (!target || target.x == null || target.y == null) continue;

    const hostCx = host.x + (host.width || 100) / 2;
    const hostCy = host.y + (host.height || 80) / 2;
    const hostH = host.height || 80;
    const targetCx = target.x + (target.width || 36) / 2;
    const targetCy = target.y + (target.height || 36) / 2;

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
    // Only pick 'right' if target is on roughly the same row
    if (dx > 0 && Math.abs(dy) < hostH) {
      return 'right';
    }

    return 'bottom'; // default: exception flows exit downward
  }

  return 'bottom'; // fallback
}

/**
 * Compute the target centre position for a boundary event on a given
 * border of its host element.
 */
function computeBoundaryPosition(
  host: any,
  border: 'top' | 'bottom' | 'left' | 'right'
): { cx: number; cy: number } {
  const hostW = host.width || 100;
  const hostH = host.height || 80;

  switch (border) {
    case 'top':
      return { cx: host.x + hostW * 0.67, cy: host.y };
    case 'bottom':
      return { cx: host.x + hostW * 0.5, cy: host.y + hostH };
    case 'left':
      return { cx: host.x, cy: host.y + hostH * 0.67 };
    case 'right':
      return { cx: host.x + hostW, cy: host.y + hostH * 0.67 };
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
  elementRegistry: any,
  _modeling: any,
  snapshots?: BoundaryEventSnapshot[]
): void {
  // When snapshots are provided, we're running after a full layout and
  // should always reposition boundary events to the correct border.
  const forceReposition = snapshots !== undefined && snapshots.length > 0;

  // Find boundary events: prefer type-based filter, but also check
  // snapshots for elements whose type was corrupted.
  const byType = elementRegistry.filter((el: any) => el.type === 'bpmn:BoundaryEvent');
  const foundIds = new Set(byType.map((el: any) => el.id));
  const boundaryEvents: any[] = [...byType];

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
    if (be.type !== 'bpmn:BoundaryEvent') {
      be.type = 'bpmn:BoundaryEvent';
    }
    const bo = be.businessObject;
    if (bo && bo.$type !== 'bpmn:BoundaryEvent') {
      try {
        Object.defineProperty(bo, '$type', {
          value: 'bpmn:BoundaryEvent',
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

    const beW = be.width || 36;
    const beH = be.height || 36;
    const beCx = be.x + beW / 2;
    const beCy = be.y + beH / 2;

    // After a full layout, always reposition to the optimal border.
    // Otherwise, only reposition if the boundary event is far from its host.
    let needsReposition = forceReposition;

    if (!needsReposition) {
      const hostRight = host.x + (host.width || 100);
      const hostBottom = host.y + (host.height || 80);
      const tolerance = 60;

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
}
