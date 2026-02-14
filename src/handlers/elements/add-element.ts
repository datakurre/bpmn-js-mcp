/**
 * Handler for add_bpmn_element tool.
 */

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  requireElement,
  syncXml,
  generateDescriptiveId,
  validateArgs,
  createBusinessObject,
  getVisibleElements,
  getService,
} from '../helpers';
import { STANDARD_BPMN_GAP, getElementSize } from '../../constants';
import { appendLintFeedback } from '../../linter';
import { handleInsertElement } from './insert-element';
import {
  shiftDownstreamElements,
  snapToLane,
  createAndPlaceElement,
  avoidCollision,
} from './add-element-helpers';
import {
  autoConnectToElement,
  applyEventDefinitionShorthand,
  collectAddElementWarnings,
  buildAddElementResult,
} from './add-element-response';
import { validateElementType, ALLOWED_ELEMENT_TYPES } from '../element-type-validation';
import { illegalCombinationError, typeMismatchError, duplicateError } from '../../errors';

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
  /** Place the element into a specific lane (auto-centers vertically within the lane). */
  laneId?: string;
  /** When true, reject creation if another element with the same type and name already exists. Default: false. */
  ensureUnique?: boolean;
  /**
   * Clarify positioning intent:
   * - 'auto': default placement with collision avoidance (default)
   * - 'after': position after afterElementId (requires afterElementId)
   * - 'absolute': use exact x/y coordinates, no collision avoidance
   * - 'insert': insert into existing flow (requires flowId)
   */
  placementStrategy?: 'auto' | 'after' | 'absolute' | 'insert';
  /**
   * Control collision avoidance behavior:
   * - 'shift': shift right until no overlap (default for 'auto')
   * - 'none': no collision avoidance (elements may overlap)
   */
  collisionPolicy?: 'shift' | 'none';
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
  validateElementType(args.elementType, ALLOWED_ELEMENT_TYPES);

  // ── Validate incompatible argument combinations ────────────────────────
  if (args.elementType === 'bpmn:BoundaryEvent' && !args.hostElementId) {
    throw illegalCombinationError(
      'BoundaryEvent requires hostElementId to specify the element to attach to. ' +
        'Use hostElementId to reference the task or subprocess this boundary event should be attached to.',
      ['elementType', 'hostElementId']
    );
  }

  if (args.elementType === 'bpmn:BoundaryEvent' && args.afterElementId) {
    throw illegalCombinationError(
      'BoundaryEvent cannot use afterElementId — boundary events are positioned relative to their host element. ' +
        'Use hostElementId instead.',
      ['elementType', 'afterElementId']
    );
  }

  if (args.flowId && args.afterElementId) {
    throw illegalCombinationError(
      'Cannot use both flowId and afterElementId. flowId inserts into an existing sequence flow; ' +
        'afterElementId positions the element after another element. Choose one.',
      ['flowId', 'afterElementId']
    );
  }

  if (args.flowId && (args.x !== undefined || args.y !== undefined)) {
    // Not an error — just ignored. flowId overrides x/y positioning.
    // Documented in the tool description.
  }

  if (args.afterElementId && (args.x !== undefined || args.y !== undefined)) {
    // Not an error — afterElementId auto-positions relative to the reference element.
    // x/y are ignored. We capture this to include a warning in the response.
  }

  if (args.eventDefinitionType && !args.elementType.includes('Event')) {
    throw typeMismatchError(args.elementType, args.elementType, [
      'bpmn:StartEvent',
      'bpmn:EndEvent',
      'bpmn:IntermediateCatchEvent',
      'bpmn:IntermediateThrowEvent',
      'bpmn:BoundaryEvent',
    ]);
  }

  // Validate placementStrategy consistency
  if (args.placementStrategy === 'after' && !args.afterElementId) {
    throw illegalCombinationError('placementStrategy "after" requires afterElementId to be set.', [
      'placementStrategy',
      'afterElementId',
    ]);
  }
  if (args.placementStrategy === 'insert' && !args.flowId) {
    throw illegalCombinationError('placementStrategy "insert" requires flowId to be set.', [
      'placementStrategy',
      'flowId',
    ]);
  }

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

  // ensureUnique: reject creation if another element with same type+name exists
  if (args.ensureUnique && elementName) {
    const duplicates = getVisibleElements(elementRegistry).filter(
      (el: any) => el.type === elementType && el.businessObject?.name === elementName
    );
    if (duplicates.length > 0) {
      throw duplicateError(
        `ensureUnique: an element with type ${elementType} and name "${elementName}" already exists: ${duplicates.map((d: any) => d.id).join(', ')}. ` +
          `Set ensureUnique to false to allow duplicates.`,
        duplicates.map((d: any) => d.id)
      );
    }
  }

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

  // Explicit laneId: override Y to center the element within the specified lane
  let assignToLaneId: string | undefined;
  if (args.laneId) {
    const targetLane = requireElement(elementRegistry, args.laneId);
    if (targetLane.type !== 'bpmn:Lane') {
      throw typeMismatchError(args.laneId, targetLane.type, ['bpmn:Lane']);
    }
    // Center the element vertically in the lane
    const laneCy = targetLane.y + (targetLane.height || 0) / 2;
    y = laneCy;
    assignToLaneId = args.laneId;
  }

  // Collision avoidance: shift right if position overlaps an existing element.
  // Respects placementStrategy and collisionPolicy parameters.
  const strategy = args.placementStrategy || 'auto';
  const collisionPolicy = args.collisionPolicy || 'shift';
  const usingDefaultPosition = args.x === undefined && args.y === undefined;
  const shouldAvoidCollisions =
    collisionPolicy !== 'none' &&
    strategy !== 'absolute' &&
    usingDefaultPosition &&
    !hostElementId &&
    !afterElementId;
  if (shouldAvoidCollisions) {
    const avoided = avoidCollision(elementRegistry, x, y, elementSize.width, elementSize.height);
    x = avoided.x;
    y = avoided.y;
  }

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

  // Register element in lane's flowNodeRef list if laneId was specified
  if (assignToLaneId) {
    const targetLane = elementRegistry.get(assignToLaneId);
    if (targetLane?.businessObject) {
      const refs: unknown[] =
        (targetLane.businessObject.flowNodeRef as unknown[] | undefined) || [];
      if (!targetLane.businessObject.flowNodeRef) {
        targetLane.businessObject.flowNodeRef = refs;
      }
      const elemBo = createdElement.businessObject;
      if (elemBo && !refs.includes(elemBo)) {
        refs.push(elemBo);
      }
    }
  }

  // Auto-connect to afterElement when requested (default: true for afterElementId)
  const { connectionId, connectionsCreated } = autoConnectToElement(
    elementRegistry,
    modeling,
    afterElementId,
    createdElement,
    elementName,
    args.autoConnect
  );

  await syncXml(diagram);

  // ── Boundary event shorthand: set event definition in one call ─────────
  const eventDefinitionApplied = await applyEventDefinitionShorthand(
    diagramId,
    createdElement,
    diagram,
    args
  );

  // Collect warnings and build result
  const warnings = collectAddElementWarnings({
    afterElementId,
    argsX: args.x,
    argsY: args.y,
    assignToLaneId,
    hostElementId,
    elementType,
    elementName,
    createdElementId: createdElement.id,
    elementRegistry,
  });

  const result = buildAddElementResult({
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
  });
  return appendLintFeedback(result, diagram);
}

// Schema extracted to add-element-schema.ts (R1.5) for readability.
export { TOOL_DEFINITION } from './add-element-schema';
