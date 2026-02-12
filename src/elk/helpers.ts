/**
 * Element type classification helpers for the ELK layout engine.
 */

import type { BpmnElement } from '../bpmn-types';

export function isConnection(type: string): boolean {
  return (
    type.includes('SequenceFlow') || type.includes('MessageFlow') || type.includes('Association')
  );
}

export function isInfrastructure(type: string): boolean {
  return (
    !type ||
    type === 'bpmn:Process' ||
    type === 'bpmn:Collaboration' ||
    type === 'label' ||
    type.includes('BPMNDiagram') ||
    type.includes('BPMNPlane')
  );
}

/** Check if an element type is an artifact (data object, data store, text annotation, group). */
export function isArtifact(type: string): boolean {
  return (
    type === 'bpmn:TextAnnotation' ||
    type === 'bpmn:DataObjectReference' ||
    type === 'bpmn:DataStoreReference' ||
    type === 'bpmn:Group'
  );
}

/** Check if an element type is a lane (excluded from ELK layout). */
export function isLane(type: string): boolean {
  return type === 'bpmn:Lane' || type === 'bpmn:LaneSet';
}

/**
 * Check if an element should be included in ELK layout calculations.
 * Returns true for flow nodes (tasks, events, gateways, subprocesses).
 * Returns false for infrastructure, connections, artifacts, labels, participants, lanes, and boundary events.
 */
export function isLayoutableShape(el: BpmnElement): boolean {
  return (
    !isInfrastructure(el.type) &&
    !isConnection(el.type) &&
    !isArtifact(el.type) &&
    !isLane(el.type) &&
    el.type !== 'label' &&
    el.type !== 'bpmn:Participant' &&
    el.type !== 'bpmn:BoundaryEvent'
  );
}
