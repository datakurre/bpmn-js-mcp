/**
 * Handler for add_bpmn_element tool.
 */

import { type ToolResult } from '../types';
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

export interface AddElementArgs {
  diagramId: string;
  elementType: string;
  name?: string;
  x?: number;
  y?: number;
  hostElementId?: string;
  afterElementId?: string;
  participantId?: string;
  /** Insert into an existing sequence flow, splitting and reconnecting automatically. */
  flowId?: string;
  /** For SubProcess: true = expanded (large, inline children), false = collapsed (small, separate drilldown plane). Default: true. */
  isExpanded?: boolean;
  /** When afterElementId is set, automatically create a sequence flow from the reference element. Default: true. */
  autoConnect?: boolean;
  /** Boundary event shorthand: set event definition type in one call. */
  eventDefinitionType?: string;
  /** Boundary event shorthand: event definition properties (timer, condition, etc.). */
  eventDefinitionProperties?: Record<string, unknown>;
  /** Boundary event shorthand: error reference for ErrorEventDefinition. */
  errorRef?: { id: string; name?: string; errorCode?: string };
  /** Boundary event shorthand: message reference for MessageEventDefinition. */
  messageRef?: { id: string; name?: string };
  /** Boundary event shorthand: signal reference for SignalEventDefinition. */
  signalRef?: { id: string; name?: string };
  /** Boundary event shorthand: escalation reference for EscalationEventDefinition. */
  escalationRef?: { id: string; name?: string; escalationCode?: string };
}

// ── Main handler ───────────────────────────────────────────────────────────

// eslint-disable-next-line complexity, max-lines-per-function, sonarjs/cognitive-complexity
export async function handleAddElement(args: AddElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementType']);

  // Delegate to insert-into-flow handler when flowId is provided
  const { flowId } = args;
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
  // SubProcess defaults to expanded (true) unless explicitly set to false
  const isExpanded = elementType === 'bpmn:SubProcess' ? args.isExpanded !== false : undefined;
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
    isExpanded,
  });

  if (elementName) {
    modeling.updateProperties(createdElement, { name: elementName });
  }

  // Auto-connect to afterElement when requested (default: true for afterElementId)
  const { autoConnect } = args;
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
  const evtDefType = args.eventDefinitionType;
  if (evtDefType && createdElement.businessObject?.$type?.includes('Event')) {
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

// Schema extracted to add-element-schema.ts (R1.5) for readability.
export { TOOL_DEFINITION } from './add-element-schema';
