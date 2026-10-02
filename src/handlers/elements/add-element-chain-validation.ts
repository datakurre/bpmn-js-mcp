/**
 * Up-front validation for add_bpmn_element's `elements` form (see add-element-chain.ts).
 */

import {
  missingRequiredError,
  typeMismatchError,
  semanticViolationError,
  illegalCombinationError,
} from '../../errors';
import { getService } from '../../bpmn-types';
import type { requireDiagram } from '../helpers';
import type { AddElementChainArgs } from './add-element-chain';

export const CHAIN_ELEMENT_TYPES = new Set([
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
  'bpmn:SubProcess',
]);

/** Keys an `elements` entry may carry; anything else belongs to the single-element form. */
const ENTRY_KEYS = new Set([
  'elementType',
  'name',
  'participantId',
  'laneId',
  'x',
  'y',
  'isExpanded',
  'eventDefinitionType',
  'eventDefinitionProperties',
  'errorRef',
  'messageRef',
  'signalRef',
  'escalationRef',
]);

/** Reject entry keys outside the documented set (e.g. flowId, copyFrom, afterElementId). */
function validateEntryKeys(el: AddElementChainArgs['elements'][number], i: number): void {
  const unsupported = Object.keys(el).filter((k) => !ENTRY_KEYS.has(k));
  if (unsupported.length > 0) {
    throw illegalCombinationError(
      `elements[${i}] has unsupported key(s): ${unsupported.join(', ')}. ` +
        'Entries accept only ' +
        `${Array.from(ENTRY_KEYS).join(', ')}; use the single-element form of add_bpmn_element for other options.`,
      unsupported.map((k) => `elements[${i}].${k}`)
    );
  }
}

/**
 * Validate chain element types and EndEvent placement before creating anything.
 */
export function validateChainElements(
  elements: AddElementChainArgs['elements'],
  afterElementId: string | undefined,
  diagram: ReturnType<typeof requireDiagram>,
  connected: boolean
): void {
  // Validate all element types up front
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    validateEntryKeys(el, i);
    if (!el.elementType) {
      throw missingRequiredError([`elements[${i}].elementType`]);
    }
    if (!CHAIN_ELEMENT_TYPES.has(el.elementType)) {
      throw typeMismatchError(`elements[${i}]`, el.elementType, Array.from(CHAIN_ELEMENT_TYPES));
    }
    if (connected && (el.x !== undefined || el.y !== undefined)) {
      throw illegalCombinationError(
        `elements[${i}]: x/y are ignored when chaining (elements are auto-placed and laid out). ` +
          "Use connect: 'none' to position elements explicitly.",
        [`elements[${i}].x`, `elements[${i}].y`]
      );
    }
  }
  // Flow-sink rules only matter when elements are connected in sequence
  if (!connected) return;

  // Check if afterElementId is an EndEvent — cannot place elements after a flow sink
  if (afterElementId) {
    const elementRegistry = getService(diagram.modeler, 'elementRegistry');
    const afterEl = elementRegistry.get(afterElementId);
    if (afterEl) {
      const afterType: string = afterEl.type || afterEl.businessObject?.$type || '';
      if (afterType === 'bpmn:EndEvent') {
        throw semanticViolationError(
          `Cannot add elements after ${afterElementId} — bpmn:EndEvent is a flow sink and must not have outgoing sequence flows. ` +
            `Use a different element as afterElementId, or replace the EndEvent with an IntermediateThrowEvent if the flow should continue.`
        );
      }
    }
  }

  // Validate that EndEvent is only used as the last element in the chain
  for (let i = 0; i < elements.length - 1; i++) {
    if (elements[i].elementType === 'bpmn:EndEvent') {
      throw semanticViolationError(
        `elements[${i}] is bpmn:EndEvent but is not the last element in the chain. ` +
          `EndEvent is a flow sink and must not have outgoing sequence flows. ` +
          `Move the EndEvent to the end of the chain, or use bpmn:IntermediateThrowEvent instead.`
      );
    }
  }
}
