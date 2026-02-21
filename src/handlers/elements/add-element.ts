/**
 * Handler for add_bpmn_element tool.
 */
// @mutating

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
import { handleLayoutDiagram } from '../layout/layout-diagram';
import { handleDuplicateElement } from './duplicate-element';
import {
  shiftDownstreamElements,
  snapToLane,
  createAndPlaceElement,
  collectDownstreamElements,
  resizeParentContainers,
} from './add-element-helpers';
import { avoidCollision, avoidCollisionY } from './add-element-collision';
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
  /** Place the element inside a specific parent container (SubProcess or Participant). Child elements are nested in the parent's BPMN structure. */
  parentId?: string;
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
  /** Duplicate an existing element: copies its type, name, and camunda properties. */
  copyFrom?: string;
  /** Offset for copyFrom duplication (default: 50). */
  copyOffsetX?: number;
  /** Offset for copyFrom duplication (default: 50). */
  copyOffsetY?: number;
  /**
   * When true, run layout_bpmn_diagram automatically after adding the element.
   * Useful after the final element in an incremental build sequence.
   * Default: false.
   */
  autoLayout?: boolean;
}

// ── Main handler ───────────────────────────────────────────────────────────

// eslint-disable-next-line complexity, max-lines-per-function, sonarjs/cognitive-complexity
export async function handleAddElement(args: AddElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementType']);
  validateElementType(args.elementType, ALLOWED_ELEMENT_TYPES);

  // ── copyFrom: delegate to duplicate handler ────────────────────────────
  if (args.copyFrom) {
    return handleDuplicateElement({
      diagramId: args.diagramId,
      elementId: args.copyFrom,
      offsetX: args.copyOffsetX,
      offsetY: args.copyOffsetY,
    });
  }

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
    parentId,
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

      // C2-3: Branch-aware Y positioning.
      // If the anchor element already has outgoing connections with targets
      // at the same X level, place the new element below the lowest existing
      // target instead of stacking on top of them.  This is typical when the
      // user adds a new outgoing branch from a gateway or a branching task.
      const newSize = getElementSize(elementType);
      const existingOutgoing = (afterEl.outgoing || []).filter(
        (flow: any) =>
          flow.type?.includes('SequenceFlow') && flow.target && flow.target.x >= x - newSize.width
      );
      if (existingOutgoing.length > 0) {
        let maxBottom = 0;
        for (const flow of existingOutgoing) {
          const tgt = flow.target as any;
          if (!tgt) continue;
          const bottom = (tgt.y ?? 0) + (tgt.height ?? 0);
          if (bottom > maxBottom) maxBottom = bottom;
        }
        // Place below the lowest existing branch with a gap
        y = maxBottom + STANDARD_BPMN_GAP + newSize.height / 2;
      }

      // C2-2: BFS-based downstream shifting.
      // Instead of shifting ALL elements at x >= computed_x (blanket approach),
      // BFS-walk from afterEl along outgoing sequence flows and shift only reachable
      // downstream elements.  This prevents displacing elements on unrelated parallel
      // branches when adding a new element after one branch of a gateway.
      const shiftAmount = newSize.width + STANDARD_BPMN_GAP;
      const downstream = collectDownstreamElements(elementRegistry, afterEl, afterElementId);
      if (downstream.length > 0) {
        modeling.moveElements(downstream, { x: shiftAmount, y: 0 });
        resizeParentContainers(elementRegistry, modeling);
      } else {
        // Fallback: if no outgoing flows found, use the blanket X-threshold shift
        // to avoid newly placed element overlapping existing unconnected elements.
        shiftDownstreamElements(elementRegistry, modeling, x, shiftAmount, afterElementId);
      }
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

  // Collision avoidance: shift if position overlaps an existing element.
  // Respects placementStrategy and collisionPolicy parameters.
  // For afterElementId: nudge DOWNWARD (Y-axis) since X is already determined
  //   by the after-element positioning logic (C2-1).
  // For default placement: nudge rightward (X-axis) as before.
  const strategy = args.placementStrategy || 'auto';
  const collisionPolicy = args.collisionPolicy || 'shift';
  const usingDefaultPosition = args.x === undefined && args.y === undefined;
  const shouldAvoidCollisions =
    collisionPolicy !== 'none' && strategy !== 'absolute' && usingDefaultPosition && !hostElementId;

  // Build a set of element IDs to exclude from collision checks.
  // Parent containers (subprocesses) should not count as collision obstacles
  // when placing a child element inside them.  Without this exclusion, the
  // parent's bounding box triggers the avoidance shift, cascading new elements
  // diagonally downward instead of in a horizontal chain.
  const collisionExcludeIds = new Set<string>();
  if (parentId) collisionExcludeIds.add(parentId);

  if (shouldAvoidCollisions) {
    if (afterElementId) {
      // C2-1: For afterElementId, nudge downward to avoid parallel-branch overlap
      const avoided = avoidCollisionY(
        elementRegistry,
        x,
        y,
        elementSize.width,
        elementSize.height,
        afterElementId,
        collisionExcludeIds.size > 0 ? collisionExcludeIds : undefined
      );
      x = avoided.x;
      y = avoided.y;
    } else {
      const avoided = avoidCollision(
        elementRegistry,
        x,
        y,
        elementSize.width,
        elementSize.height,
        collisionExcludeIds.size > 0 ? collisionExcludeIds : undefined
      );
      x = avoided.x;
      y = avoided.y;
    }
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
    parentId,
    isExpanded,
  });

  if (elementName) {
    modeling.updateProperties(createdElement, { name: elementName });
  }

  // bpmn:Group has a large default size (300×300 in bpmn-js) and its center
  // is placed at the requested (x, y).  When x=100 or y=100 (the defaults),
  // the top-left of the group lands at (x−150, y−150) = (−50, −50), pushing
  // it into negative coordinate space and producing an invisible element.
  // Clamp: if the created element's top-left is at a negative coordinate, move
  // it so the top-left is at (max(x, 0), max(y, 0)).
  if (elementType === 'bpmn:Group' && (createdElement.x < 0 || createdElement.y < 0)) {
    const clampDx = createdElement.x < 0 ? -createdElement.x : 0;
    const clampDy = createdElement.y < 0 ? -createdElement.y : 0;
    if (clampDx > 0 || clampDy > 0) {
      modeling.moveElements([createdElement], { x: clampDx, y: clampDy });
    }
  }

  // Register element in lane's flowNodeRef list if laneId was specified
  if (assignToLaneId) {
    const targetLane = elementRegistry.get(assignToLaneId);
    if (targetLane?.businessObject) {
      const bo = targetLane.businessObject;
      if (!bo.flowNodeRef) {
        bo.flowNodeRef = [];
      }
      const refs = bo.flowNodeRef;
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

  if (args.autoLayout) {
    await handleLayoutDiagram({ diagramId });
  }

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
