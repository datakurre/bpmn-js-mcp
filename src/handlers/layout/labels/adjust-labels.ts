/**
 * Post-processing function that adjusts external labels to bpmn-js
 * default positions (matching Camunda Modeler interactive placement).
 *
 * Entry points:
 * - `adjustDiagramLabels(diagram)` — adjusts all element labels in a diagram
 * - `adjustElementLabel(diagram, elementId)` — adjusts a single element's label
 * - `centerFlowLabels(diagram)` — centers flow labels on connection midpoints
 *
 * Heavy helpers are in label-position-helpers.ts.
 */

import { type DiagramState } from '../../../types';
import type { BpmnElement } from '../../../bpmn-types';
import { DEFAULT_LABEL_SIZE } from '../../../constants';
import { getVisibleElements, syncXml, getService } from '../../helpers';
import {
  getGatewayLabelPosition,
  getBoundaryEventLabelPosition,
  computePathMidpointLabelPos,
} from './label-position-helpers';

const BOUNDARY_EVENT_TYPE = 'bpmn:BoundaryEvent';

function hasExternalLabel(type: string): boolean {
  return (
    type.includes('Event') ||
    type.includes('Gateway') ||
    type === 'bpmn:DataStoreReference' ||
    type === 'bpmn:DataObjectReference'
  );
}

function getDefaultLabelPosition(
  element: { x: number; y: number; width: number; height: number },
  labelWidth: number,
  labelHeight: number
): { x: number; y: number } {
  const midX = element.x + element.width / 2;
  // bpmn-js formula: label centre Y = element.bottom + DEFAULT_LABEL_SIZE.height / 2
  // For the default 20px label height this places the label top at element.bottom (no gap).
  // Clamp: ensure the label top is at least 0px below element.bottom so that tall
  // multi-line labels never overlap the element's bottom border.
  const elementBottom = element.y + element.height;
  const nominalCentreY = elementBottom + DEFAULT_LABEL_SIZE.height / 2;
  // Ensure label top (centreY - labelH/2) is at least 0px below element bottom
  const minCentreY = elementBottom + labelHeight / 2;
  const centreY = Math.max(nominalCentreY, minCentreY);
  return {
    x: Math.round(midX - labelWidth / 2),
    y: Math.round(centreY - labelHeight / 2),
  };
}

function hasBoundaryOutgoingFlows(elementId: string, elements: any[]): boolean {
  return elements.some(
    (el) =>
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.source?.id === elementId
  );
}

function buildShapesList(allElements: any[]): any[] {
  return allElements.filter(
    (el: any) =>
      el.type !== 'label' &&
      !String(el.type).includes('Flow') &&
      !String(el.type).includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.x !== undefined &&
      el.width !== undefined
  );
}

export async function adjustDiagramLabels(diagram: DiagramState): Promise<number> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  const labelBearers = allElements.filter(
    (el: any) => hasExternalLabel(el.type) && el.label && el.businessObject?.name
  );
  if (labelBearers.length === 0) return 0;

  const shapes = buildShapesList(allElements);
  let movedCount = 0;

  for (const el of labelBearers) {
    const label = el.label;
    if (!label) continue;

    const labelWidth = label.width || DEFAULT_LABEL_SIZE.width;
    const labelHeight = label.height || DEFAULT_LABEL_SIZE.height;
    let target: { x: number; y: number };

    if (el.type.includes('Gateway')) {
      target = getGatewayLabelPosition(el, labelWidth, labelHeight, shapes, allElements);
    } else if (el.type === BOUNDARY_EVENT_TYPE && hasBoundaryOutgoingFlows(el.id, allElements)) {
      target = getBoundaryEventLabelPosition(el, labelWidth, labelHeight, shapes);
    } else {
      target = getDefaultLabelPosition(el, labelWidth, labelHeight);
    }

    const dx = target.x - label.x;
    const dy = target.y - label.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      modeling.moveShape(label as unknown as BpmnElement, { x: dx, y: dy });
      movedCount++;
    }
  }

  if (movedCount > 0) await syncXml(diagram);
  return movedCount;
}

export async function adjustElementLabel(
  diagram: DiagramState,
  elementId: string
): Promise<boolean> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const el = elementRegistry.get(elementId);

  if (!el || !el.label || !hasExternalLabel(el.type) || !el.businessObject?.name) return false;

  const label = el.label;
  const labelWidth = label.width || DEFAULT_LABEL_SIZE.width;
  const labelHeight = label.height || DEFAULT_LABEL_SIZE.height;
  const allVisibleElements = getVisibleElements(elementRegistry);
  const shapesForEl = buildShapesList(allVisibleElements);

  let target: { x: number; y: number };
  if (el.type.includes('Gateway')) {
    target = getGatewayLabelPosition(el, labelWidth, labelHeight, shapesForEl, allVisibleElements);
  } else if (
    el.type === BOUNDARY_EVENT_TYPE &&
    hasBoundaryOutgoingFlows(el.id, allVisibleElements)
  ) {
    target = getBoundaryEventLabelPosition(el, labelWidth, labelHeight, shapesForEl);
  } else {
    target = getDefaultLabelPosition(el, labelWidth, labelHeight);
  }

  const dx = target.x - label.x;
  const dy = target.y - label.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    modeling.moveShape(label as BpmnElement, { x: dx, y: dy });
    await syncXml(diagram);
    return true;
  }
  return false;
}

function buildGatewayLabelRects(
  allElements: any[]
): Array<{ id: string; labelRect: { x: number; y: number; width: number; height: number } }> {
  return allElements
    .filter(
      (el: any) =>
        el.type?.includes('Gateway') &&
        el.label &&
        el.businessObject?.name &&
        el.label.x !== undefined &&
        el.label.y !== undefined
    )
    .map((el: any) => ({
      id: el.id,
      labelRect: {
        x: el.label.x,
        y: el.label.y,
        width: el.label.width || DEFAULT_LABEL_SIZE.width,
        height: el.label.height || DEFAULT_LABEL_SIZE.height,
      },
    }));
}

export async function centerFlowLabels(diagram: DiagramState): Promise<number> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const allElements = getVisibleElements(elementRegistry);
  const shapes = buildShapesList(allElements);
  const gatewayLabelRects = buildGatewayLabelRects(allElements);

  const labeledFlows = allElements.filter(
    (el: any) =>
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.label &&
      el.businessObject?.name &&
      el.waypoints &&
      el.waypoints.length >= 2
  );

  let movedCount = 0;

  for (const flow of labeledFlows) {
    const label = flow.label!;
    const waypoints = flow.waypoints!;
    const labelW = label.width || DEFAULT_LABEL_SIZE.width;
    const labelH = label.height || DEFAULT_LABEL_SIZE.height;

    const extraObstacles: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const adjId of [flow.source?.id, flow.target?.id]) {
      if (!adjId) continue;
      const entry = gatewayLabelRects.find((g: any) => g.id === adjId);
      if (entry) extraObstacles.push(entry.labelRect);
    }

    // Connected element bounds: used by labelSideScore to penalise proximity
    // to source/target elements (not just overlap).
    const connectedBounds: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const endEl of [flow.source, flow.target]) {
      if (endEl && endEl.x !== undefined && endEl.width !== undefined) {
        connectedBounds.push({
          x: endEl.x,
          y: endEl.y,
          width: endEl.width,
          height: endEl.height,
        });
      }
    }

    const target = computePathMidpointLabelPos(
      waypoints,
      labelW,
      labelH,
      shapes,
      extraObstacles,
      connectedBounds
    );
    const moveX = target.x - label.x;
    const moveY = target.y - label.y;
    if (Math.abs(moveX) > 2 || Math.abs(moveY) > 2) {
      modeling.moveShape(label as unknown as BpmnElement, { x: moveX, y: moveY });
      movedCount++;
    }
  }

  if (movedCount > 0) await syncXml(diagram);
  return movedCount;
}
