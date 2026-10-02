/**
 * AutoPlace-based positioning for add-element when afterElementId is set.
 *
 * Uses bpmn-js's built-in AutoPlace service to position new elements
 * relative to a source element, with automatic SequenceFlow creation.
 */

import {
  requireElement,
  syncXml,
  generateDescriptiveId,
  createBusinessObject,
  getService,
} from '../helpers';
import { getElementSize } from '../../constants';
import { appendLintFeedback } from '../../linter';
import { resizeParentContainers } from './add-element-helpers';
import {
  applyEventDefinitionShorthand,
  collectAddElementWarnings,
  buildAddElementResult,
} from './add-element-response';
import { typeMismatchError } from '../../errors';
import type { AddElementArgs } from './add-element';
import type { ToolResult, DiagramState } from '../../types';
import type { Modeling, ElementRegistry, BpmnElement } from '../../bpmn-types';

/**
 * Assign element to a lane's flowNodeRef list, removing it from all
 * other lanes to prevent duplication.
 */
export function assignToLaneFlowNodeRef(
  elementRegistry: ElementRegistry,
  targetLaneId: string,
  element: BpmnElement
): void {
  const targetLane = elementRegistry.get(targetLaneId);
  if (!targetLane?.businessObject) return;

  const bo = targetLane.businessObject;
  if (!bo.flowNodeRef) bo.flowNodeRef = [];
  const elemBo = element.businessObject;

  // Remove from all other lanes first
  const allLanes = elementRegistry.filter((el: any) => el.type === 'bpmn:Lane');
  for (const lane of allLanes) {
    if (lane.id === targetLaneId) continue;
    const laneRefs = lane.businessObject?.flowNodeRef;
    if (laneRefs) {
      const idx = laneRefs.indexOf(elemBo);
      if (idx >= 0) laneRefs.splice(idx, 1);
    }
  }
  if (elemBo && !bo.flowNodeRef.includes(elemBo)) {
    bo.flowNodeRef.push(elemBo);
  }
}

/**
 * Clamp element into the target lane's Y-center and register in flowNodeRef.
 * Returns the lane ID if lane assignment was performed.
 */
function clampToLane(
  args: AddElementArgs,
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  createdElement: BpmnElement
): string | undefined {
  if (!args.laneId) return undefined;

  const targetLane = requireElement(elementRegistry, args.laneId);
  if (targetLane.type !== 'bpmn:Lane') {
    throw typeMismatchError(args.laneId, targetLane.type, ['bpmn:Lane']);
  }
  const laneCy = targetLane.y + (targetLane.height || 0) / 2;
  const dy = laneCy - (createdElement.y + (createdElement.height || 0) / 2);
  if (Math.abs(dy) > 1) {
    modeling.moveElements([createdElement], { x: 0, y: dy });
  }
  assignToLaneFlowNodeRef(elementRegistry, args.laneId, createdElement);
  return args.laneId;
}

/** Detect the connection AutoPlace created from afterElement to createdElement. */
function detectAutoPlaceConnection(
  createdElement: BpmnElement,
  afterElementId: string,
  autoConnect: boolean | undefined
): {
  connectionId?: string;
  connectionsCreated: Array<{ id: string; sourceId: string; targetId: string; type: string }>;
} {
  const connectionsCreated: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
  }> = [];
  let connectionId: string | undefined;
  if (autoConnect !== false) {
    const autoConns = (createdElement.incoming || []).filter(
      (c: any) => c.source?.id === afterElementId
    );
    if (autoConns.length > 0) {
      connectionId = autoConns[0].id;
      connectionsCreated.push({
        id: autoConns[0].id,
        sourceId: afterElementId,
        targetId: createdElement.id,
        type: 'bpmn:SequenceFlow',
      });
    }
  }
  return { connectionId, connectionsCreated };
}

/**
 * Detect if participantId refers to a different pool than the given element's pool.
 * Returns true when cross-pool is detected (AutoPlace should be skipped).
 */
function isCrossPoolPlacement(afterEl: BpmnElement, participantId: string | undefined): boolean {
  if (!participantId) return false;
  let el: any = afterEl;
  while (el && el.type !== 'bpmn:Participant') el = el.parent;
  return !!el && el.id !== participantId;
}

/**
 * Handle add_bpmn_elements with afterElementId using bpmn-js AutoPlace.
 *
 * AutoPlace positions the new element AND creates a SequenceFlow from
 * the source element in one step.
 *
 * When participantId refers to a different pool than afterEl's pool,
 * AutoPlace is skipped and we return null so the caller falls through to
 * standard absolute placement.
 */
export async function handleAutoPlaceAdd(
  args: AddElementArgs,
  diagram: DiagramState,
  modeling: Modeling,
  elementRegistry: ElementRegistry,
  afterElementId: string,
  elementType: string,
  elementName: string | undefined,
  hostElementId: string | undefined,
  isExpanded: boolean | undefined
): Promise<ToolResult | null> {
  const diagramId = args.diagramId;
  const afterEl = requireElement(elementRegistry, afterElementId);

  // Cross-pool check: if participantId refers to a different pool than afterEl,
  // AutoPlace would silently place the element in afterEl's pool and ignore
  // participantId. Signal the caller to use standard placement instead.
  if (isCrossPoolPlacement(afterEl, args.participantId)) {
    return null;
  }

  const descriptiveId = generateDescriptiveId(elementRegistry, elementType, elementName);
  const elementSize = getElementSize(elementType);
  const businessObject = createBusinessObject(diagram.modeler, elementType, descriptiveId);

  const shapeAttrs: Record<string, any> = { type: elementType, id: descriptiveId, businessObject };
  if (elementType === 'bpmn:SubProcess' && isExpanded !== undefined) {
    shapeAttrs.isExpanded = isExpanded;
  }

  const elementFactory = getService(diagram.modeler, 'elementFactory');
  const autoPlace = getService(diagram.modeler, 'autoPlace');

  const createdElement = autoPlace.append(afterEl, elementFactory.createShape(shapeAttrs));

  // If autoConnect is false, remove the auto-created connection
  if (args.autoConnect === false) {
    const autoConns = (createdElement.incoming || []).filter(
      (c: any) => c.source?.id === afterElementId
    );
    if (autoConns.length > 0) modeling.removeElements(autoConns);
  }

  if (elementName) modeling.updateProperties(createdElement, { name: elementName });

  const assignToLaneId = clampToLane(args, elementRegistry, modeling, createdElement);
  resizeParentContainers(elementRegistry, modeling);
  await syncXml(diagram);

  const eventDefinitionApplied = await applyEventDefinitionShorthand(
    diagramId,
    createdElement,
    diagram,
    args
  );
  const { connectionId, connectionsCreated } = detectAutoPlaceConnection(
    createdElement,
    afterElementId,
    args.autoConnect
  );
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
    participantId: args.participantId,
  });

  const result = buildAddElementResult({
    createdElement,
    elementType,
    elementName,
    x: createdElement.x,
    y: createdElement.y,
    elementSize,
    assignToLaneId,
    connectionId,
    connectionsCreated,
    eventDefinitionApplied,
    warnings,
    hostInfo: undefined,
    elementRegistry,
  });
  return appendLintFeedback(result, diagram);
}
