/**
 * Boundary event snapshot save/restore (J2 split from boundary-events.ts).
 *
 * Records each boundary event's identity before layout so it can be
 * restored after layout operations that may corrupt it in headless (jsdom)
 * mode.  Boundary events are excluded from the ELK graph and should follow
 * their host when `modeling.moveElements` moves it, but in headless mode
 * the automatic follow does not work correctly, leaving boundary events
 * stranded and sometimes type-corrupted at their original positions.
 */

import type { BpmnElement, ElementRegistry } from '../bpmn-types';

/** BPMN type string for boundary events. */
export const BPMN_BOUNDARY_EVENT_TYPE = 'bpmn:BoundaryEvent';

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
 *
 * ⚠ Command stack bypass (J3): this function directly mutates element
 * shape type, host reference, and business object properties without
 * going through bpmn-js's command stack.  These repairs are intentionally
 * non-undoable because they fix corruption introduced by headless-mode
 * layout operations that are themselves not undoable.
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
    const bo = (el as BpmnElement).businessObject;
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
