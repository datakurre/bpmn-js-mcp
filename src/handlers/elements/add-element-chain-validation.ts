/**
 * Up-front validation for add_bpmn_elements (see add-element-chain.ts).
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
import { SINGLE_ELEMENT_DEFINITION } from './add-element-schema';
import { ALLOWED_ELEMENT_TYPES } from '../validation';

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

/** Keys an `elements` entry may carry: every single-element parameter except `diagramId`. */
const ENTRY_KEYS = new Set(
  Object.keys(SINGLE_ELEMENT_DEFINITION.inputSchema.properties).filter((k) => k !== 'diagramId')
);

/** Reject entry keys that are not single-element parameters (e.g. typos, `connect`, `elements`). */
function validateEntryKeys(el: AddElementChainArgs['elements'][number], i: number): void {
  const unsupported = Object.keys(el).filter((k) => !ENTRY_KEYS.has(k));
  if (unsupported.length > 0) {
    throw illegalCombinationError(
      `elements[${i}] has unsupported key(s): ${unsupported.join(', ')}. ` +
        'Entries accept the per-element add_bpmn_elements parameters (see the elements item schema).',
      unsupported.map((k) => `elements[${i}].${k}`)
    );
  }
}

/**
 * True when an entry sets its own placement anchor or absolute position
 * (hostElementId, flowId, a handoff, a copy, afterElementId or explicit x/y).
 * Such an entry is placed there instead of being chained after the previous element.
 */
export function hasOwnAnchor(el: AddElementChainArgs['elements'][number]): boolean {
  return !!(
    el.hostElementId ||
    el.flowId ||
    el.fromElementId ||
    el.toLaneId ||
    el.afterElementId ||
    el.copyFrom ||
    el.x !== undefined ||
    el.y !== undefined
  );
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
    if (!(ALLOWED_ELEMENT_TYPES as readonly string[]).includes(el.elementType)) {
      throw typeMismatchError(`elements[${i}]`, el.elementType, [...ALLOWED_ELEMENT_TYPES]);
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
