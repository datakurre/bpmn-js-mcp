/**
 * Response building, warning collection, auto-connect, and event definition
 * shorthand helpers for the add_bpmn_element handler.
 *
 * Extracted from add-element.ts to keep the main handler focused on the
 * element creation flow.
 */

import { type DiagramState, type ToolResult } from '../../types';
import type { BpmnElement, ElementRegistry, Modeling } from '../../bpmn-types';
import {
  jsonResult,
  syncXml,
  generateFlowId,
  fixConnectionId,
  buildElementCounts,
  getVisibleElements,
} from '../helpers';
import { handleSetEventDefinition } from '../properties/set-event-definition';
import { getTypeSpecificHints, getNamingHint } from '../hints';
import { buildZShapeRoute } from '../../elk/edge-routing-helpers';

// ── Auto-connect ────────────────────────────────────────────────────────────

/** Result of auto-connecting to an element after placement. */
export interface AutoConnectResult {
  connectionId?: string;
  connectionsCreated: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
  }>;
}

/**
 * Attempt to create a sequence flow from `afterElementId` to the newly
 * created element.  Returns the connection ID and details on success,
 * or empty results if auto-connect fails or is disabled.
 */
export function autoConnectToElement(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  afterElementId: string | undefined,
  createdElement: BpmnElement,
  elementName: string | undefined,
  autoConnect: boolean | undefined
): AutoConnectResult {
  const connectionsCreated: AutoConnectResult['connectionsCreated'] = [];
  let connectionId: string | undefined;

  if (afterElementId && autoConnect !== false) {
    const afterEl = elementRegistry.get(afterElementId);
    if (afterEl) {
      try {
        const flowId = generateFlowId(elementRegistry, afterEl.businessObject?.name, elementName);
        const conn = modeling.connect(afterEl, createdElement, {
          type: 'bpmn:SequenceFlow',
          id: flowId,
        });
        fixConnectionId(conn, flowId);
        connectionId = conn.id;
        connectionsCreated.push({
          id: conn.id,
          sourceId: afterElementId,
          targetId: createdElement.id,
          type: 'bpmn:SequenceFlow',
        });

        // C2-4: Set clean orthogonal waypoints on the auto-created connection.
        // Uses a straight 2-point horizontal route when source and target are on
        // the same Y row, or a Z-shaped 4-point route for different rows.
        try {
          const srcRight = Math.round(afterEl.x + (afterEl.width || 0));
          const srcCy = Math.round(afterEl.y + (afterEl.height || 0) / 2);
          const tgtLeft = Math.round(createdElement.x);
          const tgtCy = Math.round(createdElement.y + (createdElement.height || 0) / 2);
          const SAME_ROW_THRESHOLD = 15;
          if (Math.abs(srcCy - tgtCy) <= SAME_ROW_THRESHOLD) {
            (modeling as any).updateWaypoints(conn, [
              { x: srcRight, y: srcCy },
              { x: tgtLeft, y: srcCy },
            ]);
          } else {
            (modeling as any).updateWaypoints(
              conn,
              buildZShapeRoute(srcRight, srcCy, tgtLeft, tgtCy)
            );
          }
        } catch {
          // Waypoint update is non-fatal — default bpmn-js routing is used as fallback
        }
      } catch {
        // Auto-connect may fail for some element type combinations — non-fatal
      }
    }
  }

  return { connectionId, connectionsCreated };
}

// ── Event definition shorthand ──────────────────────────────────────────────

/**
 * Apply event definition shorthand: sets an event definition on the newly
 * created element in one call (e.g. TimerEventDefinition on a BoundaryEvent).
 *
 * Returns the event definition type string if applied, or undefined.
 */
export async function applyEventDefinitionShorthand(
  diagramId: string,
  createdElement: BpmnElement,
  diagram: DiagramState,
  args: {
    eventDefinitionType?: string;
    eventDefinitionProperties?: Record<string, unknown>;
    errorRef?: { id: string; name?: string; errorCode?: string };
    messageRef?: { id: string; name?: string };
    signalRef?: { id: string; name?: string };
    escalationRef?: { id: string; name?: string; escalationCode?: string };
  }
): Promise<string | undefined> {
  const evtDefType = args.eventDefinitionType;
  if (!evtDefType || !createdElement.businessObject?.$type?.includes('Event')) {
    return undefined;
  }

  await handleSetEventDefinition({
    diagramId,
    elementId: createdElement.id,
    eventDefinitionType: evtDefType,
    properties: args.eventDefinitionProperties,
    errorRef: args.errorRef,
    messageRef: args.messageRef,
    signalRef: args.signalRef,
    escalationRef: args.escalationRef,
  });
  await syncXml(diagram);
  return evtDefType;
}

// ── Warning collection ──────────────────────────────────────────────────────

/**
 * Collect contextual warnings for the add-element response.
 *
 * Warns about:
 * - x/y coordinates ignored when afterElementId is provided
 * - Flow elements added to a process with lanes but no laneId specified
 * - Duplicate elements with the same type and name
 */
export function collectAddElementWarnings(opts: {
  afterElementId?: string;
  argsX?: number;
  argsY?: number;
  assignToLaneId?: string;
  hostElementId?: string;
  elementType: string;
  elementName?: string;
  createdElementId: string;
  elementRegistry: ElementRegistry;
}): string[] {
  const {
    afterElementId,
    argsX,
    argsY,
    assignToLaneId,
    hostElementId,
    elementType,
    elementName,
    createdElementId,
    elementRegistry,
  } = opts;

  const needsConnection =
    elementType.includes('Event') ||
    elementType.includes('Task') ||
    elementType.includes('Gateway') ||
    elementType.includes('SubProcess') ||
    elementType.includes('CallActivity');

  const warnings: string[] = [];

  if (afterElementId && (argsX !== undefined || argsY !== undefined)) {
    warnings.push(
      'x/y coordinates were ignored because afterElementId was provided (element is auto-positioned relative to the reference element).'
    );
  }

  // Warn when adding a flow element to a process with lanes but no laneId specified
  if (
    !assignToLaneId &&
    !hostElementId &&
    needsConnection &&
    elementType !== 'bpmn:BoundaryEvent'
  ) {
    const lanes = getVisibleElements(elementRegistry).filter((el: any) => el.type === 'bpmn:Lane');
    if (lanes.length > 0) {
      const laneNames = lanes
        .map((l: any) => `${l.id} ("${l.businessObject?.name || 'unnamed'}")`)
        .join(', ');
      warnings.push(
        `This process has lanes but no laneId was specified. The element may be outside all lanes. ` +
          `Consider specifying laneId to place the element in a lane. Available lanes: ${laneNames}`
      );
    }
  }

  // Duplicate detection: warn if another element with same type+name exists
  if (elementName) {
    const duplicates = getVisibleElements(elementRegistry).filter(
      (el: any) =>
        el.id !== createdElementId &&
        el.type === elementType &&
        el.businessObject?.name === elementName
    );
    if (duplicates.length > 0) {
      warnings.push(
        `An element with the same type (${elementType}) and name ("${elementName}") already exists: ${duplicates.map((d: any) => d.id).join(', ')}. ` +
          `This may indicate accidental duplication.`
      );
    }
  }

  return warnings;
}

// ── Result building ─────────────────────────────────────────────────────────

/**
 * Build the JSON result object for a successful add-element operation.
 */
export function buildAddElementResult(opts: {
  createdElement: BpmnElement;
  elementType: string;
  elementName?: string;
  x: number;
  y: number;
  elementSize: { width: number; height: number };
  assignToLaneId?: string;
  connectionId?: string;
  connectionsCreated: AutoConnectResult['connectionsCreated'];
  eventDefinitionApplied?: string;
  warnings: string[];
  hostInfo?: { hostElementId: string; hostElementType: string; hostElementName?: string };
  elementRegistry: ElementRegistry;
}): ToolResult {
  const {
    createdElement,
    elementType,
    elementName,
    x,
    y,
    elementSize,
    assignToLaneId,
    connectionId,
    connectionsCreated,
    eventDefinitionApplied,
    warnings,
    hostInfo,
    elementRegistry,
  } = opts;

  const needsConnection =
    elementType.includes('Event') ||
    elementType.includes('Task') ||
    elementType.includes('Gateway') ||
    elementType.includes('SubProcess') ||
    elementType.includes('CallActivity');
  const hint =
    needsConnection && !connectionId
      ? ' (not connected - use connect_bpmn_elements to create sequence flows)'
      : '';

  return jsonResult({
    success: true,
    elementId: createdElement.id,
    elementType,
    name: elementName,
    position: { x, y },
    di: {
      x: createdElement.x,
      y: createdElement.y,
      width: createdElement.width || elementSize.width,
      height: createdElement.height || elementSize.height,
    },
    ...(assignToLaneId ? { laneId: assignToLaneId } : {}),
    ...(connectionId ? { connectionId, autoConnected: true } : {}),
    ...(connectionsCreated.length > 0 ? { connectionsCreated } : {}),
    ...(eventDefinitionApplied ? { eventDefinitionType: eventDefinitionApplied } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(hostInfo
      ? {
          attachedTo: hostInfo,
          message: `Added ${elementType} attached to ${hostInfo.hostElementType} '${hostInfo.hostElementName || hostInfo.hostElementId}'${eventDefinitionApplied ? ` with ${eventDefinitionApplied}` : ''}${hint}`,
        }
      : {
          message: `Added ${elementType} to diagram${eventDefinitionApplied ? ` with ${eventDefinitionApplied}` : ''}${hint}`,
        }),
    diagramCounts: buildElementCounts(elementRegistry),
    ...getTypeSpecificHints(elementType),
    ...getNamingHint(elementType, elementName),
  });
}
