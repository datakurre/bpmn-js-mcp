/**
 * Event-definition mutation logic, plus the internal handleSetEventDefinition
 * function (no longer a registered MCP tool — see ADR-028; set_bpmn_event_definition
 * was removed outright and folded into set_bpmn_element_properties's
 * eventDefinition sub-object, per #23's no-alias policy).
 */
// @mutating

import { type ToolResult } from '../../types';
import {
  illegalCombinationError,
  missingRequiredError,
  typeMismatchError,
  invalidEnumError,
} from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  resolveOrCreateError,
  resolveOrCreateMessage,
  resolveOrCreateSignal,
  resolveOrCreateEscalation,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';
import { EVENT_DEFINITION_TYPE_VALUES } from './set-event-definition-schema';

export interface SetEventDefinitionArgs {
  diagramId: string;
  elementId: string;
  eventDefinitionType: string;
  properties?: Record<string, any>;
  errorRef?: { id: string; name?: string; errorCode?: string; errorMessage?: string };
  messageRef?: { id: string; name?: string };
  signalRef?: { id: string; name?: string };
  escalationRef?: { id: string; name?: string; escalationCode?: string };
  /** Variable mappings to pass with a signal throw event (camunda:In on SignalEventDefinition). */
  inMappings?: Array<{
    source?: string;
    sourceExpression?: string;
    target?: string;
    variables?: 'all';
    local?: boolean;
  }>;
}

// ── Type-specific attribute builders ───────────────────────────────────────

const EVENT_DEFINITION_TYPES = new Set<string>(EVENT_DEFINITION_TYPE_VALUES);

/** Throws unless exactly one of timeDuration/timeDate/timeCycle is present; returns that key. */
function validateTimerKeys(defProps: Record<string, any>): string[] {
  const timerKeys = ['timeDuration', 'timeDate', 'timeCycle'].filter((k) => defProps[k]);
  if (timerKeys.length > 1) {
    throw illegalCombinationError(
      `Timer events accept only one of timeDuration, timeDate, or timeCycle — got: ${timerKeys.join(', ')}`,
      timerKeys
    );
  }
  if (timerKeys.length === 0) {
    throw missingRequiredError(['timeDuration']);
  }
  return timerKeys;
}

/** Build timer attributes (exactly one of timeDuration/timeDate/timeCycle). */
function buildTimerAttrs(moddle: any, defProps: Record<string, any>): Record<string, any> {
  const timerKeys = validateTimerKeys(defProps);
  const attrs: Record<string, any> = {};
  for (const key of timerKeys) {
    attrs[key] = moddle.create('bpmn:FormalExpression', { body: defProps[key] });
  }
  return attrs;
}

/** Resolve root-level definitions element from the diagram. */
function getDefinitions(diagram: ReturnType<typeof requireDiagram>): any {
  const canvas = getService(diagram.modeler, 'canvas');
  return canvas.getRootElement().businessObject.$parent;
}

/** Ref-type → resolver function + arg key mapping. */
const REF_RESOLVERS: Record<
  string,
  { argKey: string; attrKey: string; resolver: (...a: any[]) => any }
> = {
  'bpmn:ErrorEventDefinition': {
    argKey: 'errorRef',
    attrKey: 'errorRef',
    resolver: resolveOrCreateError,
  },
  'bpmn:MessageEventDefinition': {
    argKey: 'messageRef',
    attrKey: 'messageRef',
    resolver: resolveOrCreateMessage,
  },
  'bpmn:SignalEventDefinition': {
    argKey: 'signalRef',
    attrKey: 'signalRef',
    resolver: resolveOrCreateSignal,
  },
  'bpmn:EscalationEventDefinition': {
    argKey: 'escalationRef',
    attrKey: 'escalationRef',
    resolver: resolveOrCreateEscalation,
  },
};

// ── Camunda extension attributes on event definitions ──────────────────────

/** Map of eventDefinitionType → Camunda property names to copy from defProps. */
const CAMUNDA_EVENT_DEF_PROPS: Record<string, string[]> = {
  'bpmn:ConditionalEventDefinition': ['variableName', 'variableEvents'],
  'bpmn:ErrorEventDefinition': ['errorCodeVariable', 'errorMessageVariable'],
  'bpmn:EscalationEventDefinition': ['escalationCodeVariable'],
  'bpmn:SignalEventDefinition': ['async'],
};

/** Apply Camunda-specific extension props (variableName, errorCodeVariable, etc.) to an event definition. */
function applyCamundaEventDefProps(
  eventDef: any,
  eventDefinitionType: string,
  defProps: Record<string, any>
): void {
  const propNames = CAMUNDA_EVENT_DEF_PROPS[eventDefinitionType];
  if (!propNames) return;
  for (const prop of propNames) {
    if (defProps[prop] != null) {
      eventDef[prop] = defProps[prop];
    }
  }
}

// ── Ref-type validation ────────────────────────────────────────────────────

/** Map each event definition type to its allowed ref key; all others are rejected. */
const ALLOWED_REFS: Record<string, string | undefined> = {
  'bpmn:ErrorEventDefinition': 'errorRef',
  'bpmn:MessageEventDefinition': 'messageRef',
  'bpmn:SignalEventDefinition': 'signalRef',
  'bpmn:EscalationEventDefinition': 'escalationRef',
};

const REF_KEYS = ['errorRef', 'messageRef', 'signalRef', 'escalationRef'] as const;

/** Throw if the caller supplies a ref arg that doesn't match the eventDefinitionType. */
function validateRefArgs(eventDefinitionType: string, args: Record<string, any>): void {
  const allowedRef = ALLOWED_REFS[eventDefinitionType];
  for (const key of REF_KEYS) {
    if (args[key] && key !== allowedRef) {
      const expected = allowedRef
        ? `Only ${allowedRef} is valid for ${eventDefinitionType}.`
        : `${eventDefinitionType} does not accept any ref arguments.`;
      throw illegalCombinationError(
        `Invalid argument "${key}" for ${eventDefinitionType}. ${expected}`,
        [key]
      );
    }
  }
}

// ── Signal variable mapping helpers ────────────────────────────────────────

interface InMappingSpec {
  source?: string;
  sourceExpression?: string;
  target?: string;
  variables?: 'all';
  local?: boolean;
}

/** Apply camunda:In variable mappings as extension elements on a SignalEventDefinition. */
function applySignalInMappings(
  moddle: any,
  eventDef: any,
  eventDefinitionType: string,
  inMappings: InMappingSpec[]
): void {
  if (eventDefinitionType !== 'bpmn:SignalEventDefinition') {
    throw typeMismatchError('eventDefinitionType', eventDefinitionType, [
      'bpmn:SignalEventDefinition',
    ]);
  }
  const extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
  extElements.$parent = eventDef;
  for (const mapping of inMappings) {
    const attrs: Record<string, any> = {};
    if (mapping.variables === 'all') {
      attrs.variables = 'all';
    } else {
      if (mapping.source) attrs.source = mapping.source;
      if (mapping.sourceExpression) attrs.sourceExpression = mapping.sourceExpression;
      if (mapping.target) attrs.target = mapping.target;
    }
    if (mapping.local) attrs.local = true;
    const inEl = moddle.create('camunda:In', attrs);
    inEl.$parent = extElements;
    (extElements.values as unknown[]).push(inEl);
  }
  eventDef.extensionElements = extElements;
}

/** Build event definition attributes from type-specific properties. */
function buildEventDefAttrs(
  moddle: any,
  eventDefinitionType: string,
  defProps: Record<string, any>
): Record<string, any> {
  if (eventDefinitionType === 'bpmn:TimerEventDefinition') {
    return buildTimerAttrs(moddle, defProps);
  }
  if (eventDefinitionType === 'bpmn:ConditionalEventDefinition' && defProps.condition) {
    return { condition: moddle.create('bpmn:FormalExpression', { body: defProps.condition }) };
  }
  if (eventDefinitionType === 'bpmn:LinkEventDefinition' && defProps.name) {
    return { name: defProps.name };
  }
  return {};
}

// ── Main handler ───────────────────────────────────────────────────────────

/** Throws unless `effectiveType` is an event element. */
export function assertEventDefinitionTarget(effectiveType: string, elementId: string): void {
  if (!effectiveType.includes('Event')) {
    throw typeMismatchError(elementId, effectiveType, [
      'bpmn:StartEvent',
      'bpmn:EndEvent',
      'bpmn:IntermediateCatchEvent',
      'bpmn:IntermediateThrowEvent',
      'bpmn:BoundaryEvent',
    ]);
  }
}

export interface SetEventDefinitionCoreResult {
  eventDefinitionType: string;
}

/**
 * Validate `eventDefinition` args without mutating or creating anything:
 * `eventDefinitionType` is present and recognized, ref args match the type,
 * and (for timers) exactly one of timeDuration/timeDate/timeCycle is given.
 * Run this before applying any item in a batch (see `set-properties.ts`) so a
 * bad item fails before anything is changed, with a clear message — the same
 * checks `applySetEventDefinitionCore` performs, but without the side
 * effects that would otherwise land mid-batch, before that item's own
 * `assertEventDefinitionTarget`/element-existence checks even run.
 */
export function validateEventDefinitionArgs(
  args: Omit<SetEventDefinitionArgs, 'diagramId' | 'elementId'>
): void {
  const {
    eventDefinitionType,
    properties: defProps = {},
    errorRef,
    messageRef,
    signalRef,
    escalationRef,
  } = args;

  if (!eventDefinitionType) {
    throw missingRequiredError(['eventDefinitionType']);
  }
  if (!EVENT_DEFINITION_TYPES.has(eventDefinitionType)) {
    throw invalidEnumError('eventDefinitionType', eventDefinitionType, [
      ...EVENT_DEFINITION_TYPE_VALUES,
    ]);
  }
  validateRefArgs(eventDefinitionType, { errorRef, messageRef, signalRef, escalationRef });
  if (eventDefinitionType === 'bpmn:TimerEventDefinition') {
    validateTimerKeys(defProps);
  }
}

/**
 * Build and apply an event definition, replacing any existing one. Synchronous
 * — no XML sync or lint feedback — so it is safe to call from within a
 * command-stack `preExecute` (see `applyPropertyUpdateItem` in
 * `set-properties.ts`) alongside other elements' updates, grouped into one
 * undo step.
 */
export function applySetEventDefinitionCore(
  diagram: ReturnType<typeof requireDiagram>,
  elementId: string,
  args: Omit<SetEventDefinitionArgs, 'diagramId' | 'elementId'>
): SetEventDefinitionCoreResult {
  const {
    eventDefinitionType,
    properties: defProps = {},
    errorRef,
    messageRef,
    signalRef,
    escalationRef,
    inMappings,
  } = args;

  // Validate that ref args match the event definition type
  validateRefArgs(eventDefinitionType, { errorRef, messageRef, signalRef, escalationRef });

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  assertEventDefinitionTarget(bo.$type, elementId);

  // Build event definition attributes based on type
  const eventDefAttrs = buildEventDefAttrs(moddle, eventDefinitionType, defProps);

  // Resolve root-level references (error, message, signal, escalation) —
  // through `modeling` (via resolveOrCreate*) so a newly created root
  // element is captured on the command stack and undoable.
  const refArgs: Record<string, any> = { errorRef, messageRef, signalRef, escalationRef };
  const refEntry = REF_RESOLVERS[eventDefinitionType];
  if (refEntry && refArgs[refEntry.argKey]) {
    const definitions = getDefinitions(diagram);
    eventDefAttrs[refEntry.attrKey] = refEntry.resolver(
      moddle,
      modeling,
      element,
      definitions,
      refArgs[refEntry.argKey]
    );
  }

  const eventDef = moddle.create(eventDefinitionType, eventDefAttrs);
  eventDef.$parent = bo;

  // Apply Camunda extension attributes on the event definition itself
  applyCamundaEventDefProps(eventDef, eventDefinitionType, defProps);

  // Apply camunda:In variable mappings for SignalEventDefinition
  if (inMappings && inMappings.length > 0) {
    applySignalInMappings(moddle, eventDef, eventDefinitionType, inMappings);
  }

  // Replace existing event definitions through `modeling` — NOT a direct
  // `bo.eventDefinitions = [eventDef]` first, which would make
  // UpdatePropertiesHandler read the *new* value as the "old" value to
  // restore on undo (it reads `businessObject.get('eventDefinitions')` at
  // execute time), turning undo into a no-op for this property.
  modeling.updateProperties(element, {
    eventDefinitions: [eventDef],
  });

  return { eventDefinitionType };
}

export async function handleSetEventDefinition(args: SetEventDefinitionArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'eventDefinitionType']);
  const { diagramId, elementId } = args;
  const diagram = requireDiagram(diagramId);

  const { eventDefinitionType } = applySetEventDefinitionCore(diagram, elementId, args);

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    eventDefinitionType,
    message: `Set ${eventDefinitionType} on ${elementId}`,
    nextSteps: [
      {
        tool: 'connect_bpmn_elements',
        description: 'Connect this event to the next element in the process flow.',
      },
      {
        tool: 'export_bpmn',
        description: 'Export the diagram once the process is complete.',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

// Schema extracted to set-event-definition-schema.ts to stay under max-lines.
export { EVENT_DEFINITION_SCHEMA_PROPERTIES } from './set-event-definition-schema';
