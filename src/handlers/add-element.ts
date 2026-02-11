/**
 * Handler for add_bpmn_element tool.
 */

import { type AddElementArgs, type ToolResult } from '../types';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  generateFlowId,
  validateArgs,
  createBusinessObject,
  fixConnectionId,
  buildElementCounts,
  getService,
} from './helpers';
import { STANDARD_BPMN_GAP, getElementSize } from '../constants';
import { appendLintFeedback } from '../linter';
import { handleInsertElement } from './insert-element';
import { handleSetEventDefinition } from './set-event-definition';
import { shiftDownstreamElements, snapToLane, createAndPlaceElement } from './add-element-helpers';

// ── Main handler ───────────────────────────────────────────────────────────

// eslint-disable-next-line complexity, max-lines-per-function
export async function handleAddElement(args: AddElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementType']);

  // Delegate to insert-into-flow handler when flowId is provided
  const flowId = (args as any).flowId as string | undefined;
  if (flowId) {
    return handleInsertElement({
      diagramId: args.diagramId,
      flowId,
      elementType: args.elementType,
      name: args.name,
    });
  }

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

  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

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

  // Pre-create the business object with our descriptive ID so the
  // exported XML ID matches the element ID returned to callers.
  const businessObject = createBusinessObject(diagram.modeler, elementType, descriptiveId);

  const { createdElement, hostInfo } = createAndPlaceElement({
    diagram,
    elementType,
    descriptiveId,
    businessObject,
    x,
    y,
    hostElementId,
    participantId,
  });

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
        fixConnectionId(conn, flowId);
        connectionId = conn.id;
      } catch {
        // Auto-connect may fail for some element type combinations — non-fatal
      }
    }
  }

  await syncXml(diagram);

  // ── Boundary event shorthand: set event definition in one call ─────────
  let eventDefinitionApplied: string | undefined;
  const evtDefType = (args as any).eventDefinitionType as string | undefined;
  if (evtDefType && createdElement.businessObject?.$type?.includes('Event')) {
    await handleSetEventDefinition({
      diagramId,
      elementId: createdElement.id,
      eventDefinitionType: evtDefType,
      properties: (args as any).eventDefinitionProperties,
      errorRef: (args as any).errorRef,
      messageRef: (args as any).messageRef,
      signalRef: (args as any).signalRef,
      escalationRef: (args as any).escalationRef,
    });
    eventDefinitionApplied = evtDefType;
    await syncXml(diagram);
  }

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
    ...(eventDefinitionApplied ? { eventDefinitionType: eventDefinitionApplied } : {}),
    ...(hostInfo
      ? {
          attachedTo: hostInfo,
          message: `Added ${elementType} attached to ${hostInfo.hostElementType} '${hostInfo.hostElementName || hostInfo.hostElementId}'${eventDefinitionApplied ? ` with ${eventDefinitionApplied}` : ''}${hint}`,
        }
      : {
          message: `Added ${elementType} to diagram${eventDefinitionApplied ? ` with ${eventDefinitionApplied}` : ''}${hint}`,
        }),
    diagramCounts: buildElementCounts(elementRegistry),
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'add_bpmn_element',
  description:
    'Add an element (task, gateway, event, etc.) to a BPMN diagram. Supports boundary events via hostElementId and auto-positioning via afterElementId. When afterElementId is used, downstream elements are automatically shifted right to prevent overlap. Generates descriptive element IDs when a name is provided (e.g. UserTask_EnterName, Gateway_HasSurname). Naming best practices: tasks → verb-object ("Process Order", "Send Invoice"), events → object-participle or noun-state ("Order Received", "Payment Completed"), gateways → yes/no question ending with "?" ("Order valid?", "Payment successful?"). **⚠ Boundary events:** To attach a boundary event to a task or subprocess, use elementType=bpmn:BoundaryEvent together with hostElementId. Do NOT use bpmn:IntermediateCatchEvent for error/timer/signal boundary events — that creates a standalone event that is not attached to any host and will fail validation. After adding the boundary event, use set_bpmn_event_definition to set its type (error, timer, message, signal). **Modeling guidance:** For simple integrations with external systems (fire-and-forget or request-response), prefer bpmn:ServiceTask (with camunda:type="external" and camunda:topic). Use message throw/catch events when modeling explicit message exchanges with collapsed partner pools in a collaboration diagram — in Camunda 7, only one pool is executable, the others are collapsed documentation of message endpoints. For **event subprocesses** (interrupt or non-interrupt handlers that can trigger at any point during the parent process, e.g. timeout handling, cancellation), create a bpmn:SubProcess and then use set_bpmn_element_properties to set triggeredByEvent to true and isExpanded to true. The event subprocess needs its own start event with an event definition (timer, message, error, signal). Prefer event subprocesses over boundary events when the exception handling spans multiple activities or applies to the whole process scope.',
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
      flowId: {
        type: 'string',
        description:
          'Insert the element into an existing sequence flow, splitting the flow and reconnecting automatically. ' +
          "The new element is positioned at the midpoint between the flow's source and target. " +
          'When set, other positioning parameters (x, y, afterElementId) are ignored.',
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
      eventDefinitionType: {
        type: 'string',
        enum: [
          'bpmn:ErrorEventDefinition',
          'bpmn:TimerEventDefinition',
          'bpmn:MessageEventDefinition',
          'bpmn:SignalEventDefinition',
          'bpmn:TerminateEventDefinition',
          'bpmn:EscalationEventDefinition',
          'bpmn:ConditionalEventDefinition',
          'bpmn:CompensateEventDefinition',
          'bpmn:CancelEventDefinition',
          'bpmn:LinkEventDefinition',
        ],
        description:
          'Shorthand: set an event definition on the new element in one call. ' +
          'Combines add_bpmn_element + set_bpmn_event_definition. ' +
          'Especially useful for boundary events.',
      },
      eventDefinitionProperties: {
        type: 'object',
        description:
          'Properties for the event definition (e.g. timeDuration, timeDate, timeCycle for timers, condition for conditional).',
        additionalProperties: true,
      },
      errorRef: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          errorCode: { type: 'string' },
        },
        required: ['id'],
        description: 'For ErrorEventDefinition: creates or references a bpmn:Error root element.',
      },
      messageRef: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
        description:
          'For MessageEventDefinition: creates or references a bpmn:Message root element.',
      },
      signalRef: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
        description: 'For SignalEventDefinition: creates or references a bpmn:Signal root element.',
      },
      escalationRef: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          escalationCode: { type: 'string' },
        },
        required: ['id'],
        description:
          'For EscalationEventDefinition: creates or references a bpmn:Escalation root element.',
      },
    },
    required: ['diagramId', 'elementType'],
  },
} as const;
