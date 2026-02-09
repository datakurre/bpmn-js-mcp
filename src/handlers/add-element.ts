/**
 * Handler for add_bpmn_element tool.
 */

import { type AddElementArgs, type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  generateFlowId,
  getVisibleElements,
  validateArgs,
} from './helpers';
import { STANDARD_BPMN_GAP, getElementSize } from '../constants';
import { appendLintFeedback } from '../linter';

// ── Sub-function: shift downstream elements ────────────────────────────────

/**
 * Shift all non-flow elements at or to the right of `fromX` by `shiftAmount`,
 * excluding `excludeId`.  This prevents overlap when inserting a new element.
 */
function shiftDownstreamElements(
  elementRegistry: any,
  modeling: any,
  fromX: number,
  shiftAmount: number,
  excludeId: string
): void {
  const allElements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.id !== excludeId
  );
  const toShift = allElements.filter((el: any) => el.x >= fromX);
  for (const el of toShift) {
    modeling.moveElements([el], { x: shiftAmount, y: 0 });
  }

  // Resize parent pools and lanes to accommodate shifted elements
  resizeContainersForShift(elementRegistry, modeling, shiftAmount);
}

/**
 * Resize participant pools and lanes that are too narrow after elements
 * were shifted right.  Ensures elements don't end up outside their
 * containing pool or lane.
 */
function resizeContainersForShift(elementRegistry: any, modeling: any, _shiftAmount: number): void {
  // Resize participants (pools)
  const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
  for (const pool of participants) {
    // Find the rightmost child element edge
    const children = elementRegistry.filter(
      (el: any) =>
        el.parent === pool &&
        el.type !== 'bpmn:Lane' &&
        !el.type.includes('SequenceFlow') &&
        !el.type.includes('MessageFlow') &&
        !el.type.includes('Association')
    );
    if (children.length === 0) continue;

    let maxRight = 0;
    for (const child of children) {
      const right = child.x + (child.width || 0);
      if (right > maxRight) maxRight = right;
    }

    const poolRight = pool.x + (pool.width || 0);
    const padding = 50;
    if (maxRight + padding > poolRight) {
      const newWidth = maxRight - pool.x + padding;
      modeling.resizeShape(pool, {
        x: pool.x,
        y: pool.y,
        width: newWidth,
        height: pool.height || 250,
      });
    }
  }

  // Resize lanes
  const lanes = elementRegistry.filter((el: any) => el.type === 'bpmn:Lane');
  for (const lane of lanes) {
    const parent = lane.parent;
    if (parent && parent.type === 'bpmn:Participant') {
      // Lane should match parent pool width
      const poolWidth = parent.width || 600;
      if (lane.width !== poolWidth - 30) {
        modeling.resizeShape(lane, {
          x: lane.x,
          y: lane.y,
          width: poolWidth - 30,
          height: lane.height || 125,
        });
      }
    }
  }
}

/**
 * Find the lane that contains a given (x, y) coordinate.
 * Returns the lane element or undefined if no lane covers the point.
 */
function findContainingLane(elementRegistry: any, x: number, y: number): any {
  const lanes = elementRegistry.filter((el: any) => el.type === 'bpmn:Lane');
  for (const lane of lanes) {
    const lx = lane.x ?? 0;
    const ly = lane.y ?? 0;
    const lw = lane.width ?? 0;
    const lh = lane.height ?? 0;
    if (x >= lx && x <= lx + lw && y >= ly && y <= ly + lh) {
      return lane;
    }
  }
  return undefined;
}

/**
 * Snap a Y coordinate into a lane's vertical boundaries if lanes exist.
 * Ensures the element center stays within the lane.
 */
function snapToLane(
  elementRegistry: any,
  x: number,
  y: number,
  elementHeight: number
): { y: number; laneId?: string } {
  const lane = findContainingLane(elementRegistry, x, y);
  if (!lane) return { y };

  const laneTop = lane.y ?? 0;
  const laneBottom = laneTop + (lane.height ?? 0);
  const halfH = elementHeight / 2;

  let snappedY = y;
  if (y - halfH < laneTop) snappedY = laneTop + halfH + 5;
  if (y + halfH > laneBottom) snappedY = laneBottom - halfH - 5;

  return { y: snappedY, laneId: lane.id };
}

// ── Main handler ───────────────────────────────────────────────────────────

// eslint-disable-next-line complexity, max-lines-per-function
export async function handleAddElement(args: AddElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementType']);
  const {
    diagramId,
    elementType,
    name: elementName,
    hostElementId,
    afterElementId,
    participantId,
  } = args;
  let { x = 100, y = 100 } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementFactory = diagram.modeler.get('elementFactory');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  // Auto-position after another element if requested
  if (afterElementId) {
    const afterEl = elementRegistry.get(afterElementId);
    if (afterEl) {
      const afterSize = getElementSize(afterEl.type || elementType);
      x = afterEl.x + (afterEl.width || afterSize.width) + STANDARD_BPMN_GAP;
      y = afterEl.y + (afterEl.height || afterSize.height) / 2;

      // Smart insertion: shift downstream elements to the right to prevent overlap
      const newSize = getElementSize(elementType);
      shiftDownstreamElements(
        elementRegistry,
        modeling,
        x,
        newSize.width + STANDARD_BPMN_GAP,
        afterElementId
      );
    }
  }

  // Generate a descriptive ID (named → UserTask_EnterName, collision → UserTask_<random7>_EnterName, unnamed → UserTask_<random7>)
  const descriptiveId = generateDescriptiveId(elementRegistry, elementType, elementName);

  // Lane-aware Y snapping: if the target position is inside a lane,
  // ensure the element stays within lane boundaries.
  const elementSize = getElementSize(elementType);
  const laneSnap = snapToLane(elementRegistry, x, y, elementSize.height);
  y = laneSnap.y;

  const shapeOpts: Record<string, any> = { type: elementType, id: descriptiveId };

  const shape = elementFactory.createShape(shapeOpts);
  let createdElement: any;

  if (elementType === 'bpmn:BoundaryEvent' && hostElementId) {
    // Boundary events must be attached to a host
    const host = requireElement(elementRegistry, hostElementId);
    createdElement = modeling.createShape(shape, { x, y }, host, {
      attach: true,
    });
  } else if (elementType === 'bpmn:BoundaryEvent' && !hostElementId) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'BoundaryEvent requires hostElementId to specify the element to attach to'
    );
  } else if (elementType === 'bpmn:Participant') {
    // Participants create a collaboration; add via createParticipantBandShape or special handling
    const canvas = diagram.modeler.get('canvas');
    const rootElement = canvas.getRootElement();
    createdElement = modeling.createShape(shape, { x, y }, rootElement);
  } else {
    // Regular element — add to specified participant or first process/participant
    let parent: any;
    if (participantId) {
      parent = elementRegistry.get(participantId);
      if (!parent) {
        throw new McpError(ErrorCode.InvalidRequest, `Participant not found: ${participantId}`);
      }
    } else {
      parent = elementRegistry.filter(
        (el: any) => el.type === 'bpmn:Process' || el.type === 'bpmn:Participant'
      )[0];
    }
    if (!parent) {
      throw new McpError(ErrorCode.InternalError, 'No bpmn:Process found in diagram');
    }
    createdElement = modeling.createShape(shape, { x, y }, parent);
  }

  if (elementName) {
    modeling.updateProperties(createdElement, { name: elementName });
  }

  // Auto-connect to afterElement when requested (default: true for afterElementId)
  const autoConnect = (args as any).autoConnect;
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
        connectionId = conn.id;
      } catch {
        // Auto-connect may fail for some element type combinations — non-fatal
      }
    }
  }

  await syncXml(diagram);

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

  const result = jsonResult({
    success: true,
    elementId: createdElement.id,
    elementType,
    name: elementName,
    position: { x, y },
    ...(connectionId ? { connectionId, autoConnected: true } : {}),
    message: `Added ${elementType} to diagram${hint}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'add_bpmn_element',
  description:
    'Add an element (task, gateway, event, etc.) to a BPMN diagram. Supports boundary events via hostElementId and auto-positioning via afterElementId. When afterElementId is used, downstream elements are automatically shifted right to prevent overlap. Generates descriptive element IDs when a name is provided (e.g. UserTask_EnterName, Gateway_HasSurname). Naming best practices: tasks → verb-object ("Process Order", "Send Invoice"), events → object-participle or noun-state ("Order Received", "Payment Completed"), gateways → yes/no question ending with "?" ("Order valid?", "Payment successful?"). **Modeling guidance:** For simple integrations with external systems (fire-and-forget or request-response), prefer bpmn:ServiceTask (with camunda:type="external" and camunda:topic). Use message throw/catch events when modeling explicit message exchanges with collapsed partner pools in a collaboration diagram — in Camunda 7, only one pool is executable, the others are collapsed documentation of message endpoints. For **event subprocesses** (interrupt or non-interrupt handlers that can trigger at any point during the parent process, e.g. timeout handling, cancellation), create a bpmn:SubProcess and then use set_bpmn_element_properties to set triggeredByEvent to true and isExpanded to true. The event subprocess needs its own start event with an event definition (timer, message, error, signal). Prefer event subprocesses over boundary events when the exception handling spans multiple activities or applies to the whole process scope.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID returned from create_bpmn_diagram',
      },
      elementType: {
        type: 'string',
        enum: [
          'bpmn:StartEvent',
          'bpmn:EndEvent',
          'bpmn:Task',
          'bpmn:UserTask',
          'bpmn:ServiceTask',
          'bpmn:ScriptTask',
          'bpmn:ManualTask',
          'bpmn:BusinessRuleTask',
          'bpmn:SendTask',
          'bpmn:ReceiveTask',
          'bpmn:CallActivity',
          'bpmn:ExclusiveGateway',
          'bpmn:ParallelGateway',
          'bpmn:InclusiveGateway',
          'bpmn:EventBasedGateway',
          'bpmn:IntermediateCatchEvent',
          'bpmn:IntermediateThrowEvent',
          'bpmn:BoundaryEvent',
          'bpmn:SubProcess',
          'bpmn:TextAnnotation',
          'bpmn:DataObjectReference',
          'bpmn:DataStoreReference',
          'bpmn:Group',
          'bpmn:Participant',
          'bpmn:Lane',
        ],
        description: 'The type of BPMN element to add',
      },
      name: {
        type: 'string',
        description: 'The name/label for the element',
      },
      x: {
        type: 'number',
        description: 'X coordinate for the element (default: 100)',
      },
      y: {
        type: 'number',
        description: 'Y coordinate for the element (default: 100)',
      },
      hostElementId: {
        type: 'string',
        description:
          'For boundary events: the ID of the host element (task/subprocess) to attach to',
      },
      afterElementId: {
        type: 'string',
        description:
          'Place the new element to the right of this element (auto-positions x/y). Overrides explicit x/y.',
      },
      autoConnect: {
        type: 'boolean',
        description:
          'When afterElementId is set, automatically create a sequence flow from the reference element ' +
          'to the new element. Default: true. Set to false to skip auto-connection.',
      },
      participantId: {
        type: 'string',
        description:
          'For collaboration diagrams: the ID of the participant (pool) to add the element into. If omitted, uses the first participant or process.',
      },
    },
    required: ['diagramId', 'elementType'],
  },
} as const;
