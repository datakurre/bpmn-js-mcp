/**
 * Handler for set_element_properties tool.
 *
 * Automatically sets camunda:type="external" when camunda:topic is provided
 * without an explicit camunda:type value, mirroring Camunda Modeler behavior.
 *
 * Supports the `default` attribute on gateways by resolving the sequence flow
 * business object from a string ID.
 *
 * Also accepts optional inputOutput/formData/listeners/callActivityVariables/loop/
 * eventDefinition sub-objects, delegating to the respective dedicated handler
 * for each (see ADR-021 — set_bpmn_element_properties as the Camunda-setter
 * facade — and ADR-028 for eventDefinition).
 */
// @mutating

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  upsertExtensionElement,
  getService,
  buildPropertyHints,
} from '../helpers';
import { missingRequiredError, semanticViolationError } from '../../errors';
import { appendLintFeedback } from '../../linter';
import { handleScriptProperties } from './set-script-properties';
import {
  handleReplaceElement,
  replaceElementCore,
  REPLACEABLE_TYPES,
} from '../elements/replace-element';
import {
  handleSetInputOutput,
  applySetInputOutputCore,
  IO_PARAMETERS_SCHEMA_PROPERTIES,
  type IoParameterValue,
} from './set-input-output';
import {
  handleSetFormData,
  applySetFormDataCore,
  assertFormDataTarget,
  FORM_DATA_SCHEMA_PROPERTIES,
} from './set-form-data';
import {
  handleSetCamundaListeners,
  applySetCamundaListenersCore,
  assertTaskListenerTarget,
  assertErrorDefinitionTarget,
} from './set-camunda-listeners';
import { CAMUNDA_LISTENERS_SCHEMA_PROPERTIES } from './set-camunda-listeners-schema';
import {
  handleSetCallActivityVariables,
  applySetCallActivityVariablesCore,
  assertCallActivityTarget,
  CALL_ACTIVITY_VARIABLES_SCHEMA_PROPERTIES,
} from './set-call-activity-variables';
import {
  handleSetLoopCharacteristics,
  applySetLoopCharacteristicsCore,
  assertLoopTarget,
  LOOP_CHARACTERISTICS_SCHEMA_PROPERTIES,
} from './set-loop-characteristics';
import {
  handleSetEventDefinition,
  applySetEventDefinitionCore,
  assertEventDefinitionTarget,
  validateEventDefinitionArgs,
  EVENT_DEFINITION_SCHEMA_PROPERTIES,
  type SetEventDefinitionArgs,
} from './set-event-definition';

export interface SetPropertiesArgs {
  diagramId: string;
  /** Required for the single-element form. Omit when using `updates`. */
  elementId?: string;
  properties?: Record<string, any>;
  /**
   * Optional element type replacement. When provided, replaces the element type
   * (e.g. bpmn:Task → bpmn:UserTask) before setting properties.
   * Equivalent to the former replace_bpmn_element tool.
   */
  elementType?: string;
  /** Camunda input/output parameter mapping. Equivalent to the former set_bpmn_input_output_mapping tool. */
  inputOutput?: {
    inputParameters?: IoParameterValue[];
    outputParameters?: IoParameterValue[];
  };
  /** Generated task form fields. Equivalent to the former set_bpmn_form_data tool. */
  formData?: {
    businessKey?: string;
    fields: Array<Record<string, any>>;
  };
  /** Execution/task listeners and error definitions. Equivalent to the former set_bpmn_camunda_listeners tool. */
  listeners?: {
    executionListeners?: Array<Record<string, any>>;
    taskListeners?: Array<Record<string, any>>;
    errorDefinitions?: Array<Record<string, any>>;
  };
  /** CallActivity in/out variable mappings. Equivalent to the former set_bpmn_call_activity_variables tool. */
  callActivityVariables?: {
    inMappings?: Array<Record<string, any>>;
    outMappings?: Array<Record<string, any>>;
  };
  /** Loop/multi-instance characteristics. Equivalent to the former set_bpmn_loop_characteristics tool. */
  loop?: {
    loopType: 'none' | 'standard' | 'parallel' | 'sequential';
    loopCondition?: string;
    loopMaximum?: number;
    loopCardinality?: string;
    completionCondition?: string;
    collection?: string;
    elementVariable?: string;
  };
  /** Event definition to add/replace on an event element (formerly the standalone set_bpmn_event_definition tool). */
  eventDefinition?: Omit<SetEventDefinitionArgs, 'diagramId' | 'elementId'>;
  /**
   * Batch form: apply properties/elementType/sub-objects to several elements
   * in one call, as a single undo step. Alternative to the single-element
   * `elementId` (+ `properties`/`elementType`/sub-objects) fields above.
   */
  updates?: SetPropertiesUpdateItem[];
}

/** One element's worth of updates within the `updates` batch form. */
export interface SetPropertiesUpdateItem {
  elementId: string;
  properties?: SetPropertiesArgs['properties'];
  elementType?: SetPropertiesArgs['elementType'];
  inputOutput?: SetPropertiesArgs['inputOutput'];
  formData?: SetPropertiesArgs['formData'];
  listeners?: SetPropertiesArgs['listeners'];
  callActivityVariables?: SetPropertiesArgs['callActivityVariables'];
  loop?: SetPropertiesArgs['loop'];
  eventDefinition?: SetPropertiesArgs['eventDefinition'];
}

/** The six Camunda/BPMN-concern sub-objects, in the order they're applied. */
const SUB_OBJECT_DELEGATES = [
  { key: 'inputOutput', handler: handleSetInputOutput },
  { key: 'formData', handler: handleSetFormData },
  { key: 'listeners', handler: handleSetCamundaListeners },
  { key: 'callActivityVariables', handler: handleSetCallActivityVariables },
  { key: 'loop', handler: handleSetLoopCharacteristics },
  { key: 'eventDefinition', handler: handleSetEventDefinition },
] as const;

/**
 * Run every sub-object delegate present on `args` and collect each one's
 * parsed result under its key. Returns `undefined` when none are present.
 */
async function applySubObjectDelegates(
  args: SetPropertiesArgs,
  diagramId: string,
  elementId: string
): Promise<Record<string, any> | undefined> {
  const sections: Record<string, any> = {};
  for (const { key, handler } of SUB_OBJECT_DELEGATES) {
    const subArgs = (args as Record<string, any>)[key];
    if (!subArgs) continue;
    const result = await handler({ diagramId, elementId, ...subArgs } as any);
    sections[key] = JSON.parse(result.content[0].text as string);
  }
  return Object.keys(sections).length > 0 ? sections : undefined;
}

/** Merge nextSteps arrays from every applied sub-object section, deduping identical entries. */
function mergeSectionNextSteps(sections: Record<string, any>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const merged: Array<Record<string, unknown>> = [];
  for (const section of Object.values(sections)) {
    for (const step of section.nextSteps ?? []) {
      const key = JSON.stringify(step);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(step);
    }
  }
  return merged;
}

// ── Sub-functions for special-case property handling ───────────────────────

/**
 * Handle `default` property on gateways — requires a BO reference, not a string.
 * Uses updateModdleProperties to avoid ReplaceConnectionBehavior's postExecuted
 * handler which fails in headless mode.  Mutates `standardProps` in-place
 * (deletes the key after moddle-level BO assignment).
 */
function handleDefaultOnGateway(
  element: any,
  standardProps: Record<string, any>,
  elementRegistry: any,
  modeling: any
): void {
  if (standardProps['default'] == null) return;

  const elType = element.type || element.businessObject?.$type || '';
  if (!elType.includes('ExclusiveGateway') && !elType.includes('InclusiveGateway')) return;

  const flowId = standardProps['default'];
  if (typeof flowId === 'string') {
    const flowEl = elementRegistry.get(flowId);
    if (flowEl) {
      modeling.updateModdleProperties(element, element.businessObject, {
        default: flowEl.businessObject,
      });
      delete standardProps['default'];
    }
  }
}

/**
 * Handle `conditionExpression` — wraps plain string into a FormalExpression.
 * Mutates `standardProps` in-place.
 */
function handleConditionExpression(standardProps: Record<string, any>, moddle: any): void {
  const ceValue = standardProps['conditionExpression'];
  if (ceValue == null || typeof ceValue !== 'string') return;

  standardProps['conditionExpression'] = moddle.create('bpmn:FormalExpression', { body: ceValue });
}

/**
 * Handle `isExpanded` on SubProcess via bpmnReplace — this properly
 * creates/removes BPMNPlane elements and adjusts the shape size.
 * Setting isExpanded via updateProperties would incorrectly place it
 * on the business object instead of the DI shape.
 * Returns the (possibly replaced) element.  Mutates `props` in-place.
 */
function handleIsExpandedOnSubProcess(element: any, props: Record<string, any>, diagram: any): any {
  if (!('isExpanded' in props)) return element;

  const elType = element.type || element.businessObject?.$type || '';
  if (!elType.includes('SubProcess')) return element;

  const wantExpanded = !!props['isExpanded'];
  const currentlyExpanded = element.di?.isExpanded === true;
  delete props['isExpanded'];

  if (wantExpanded === currentlyExpanded) return element;

  try {
    const bpmnReplace = getService(diagram.modeler, 'bpmnReplace');
    const newElement = bpmnReplace.replaceElement(element, {
      type: elType,
      isExpanded: wantExpanded,
    });
    return newElement || element;
  } catch {
    // Fallback: directly set on DI if bpmnReplace fails
    if (element.di) {
      element.di.isExpanded = wantExpanded;
    }
    return element;
  }
}

/**
 * Handle `camunda:retryTimeCycle` — creates/removes camunda:FailedJobRetryTimeCycle
 * extension element. Mutates `camundaProps` in-place (deletes the key after processing).
 */
function handleRetryTimeCycle(element: any, camundaProps: Record<string, any>, diagram: any): void {
  if (!('camunda:retryTimeCycle' in camundaProps)) return;

  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const bo = element.businessObject;
  const cycleValue = camundaProps['camunda:retryTimeCycle'];
  delete camundaProps['camunda:retryTimeCycle'];

  if (cycleValue != null && cycleValue !== '') {
    const retryEl = moddle.create('camunda:FailedJobRetryTimeCycle', {
      body: String(cycleValue),
    });
    upsertExtensionElement(
      moddle,
      bo,
      modeling,
      element,
      'camunda:FailedJobRetryTimeCycle',
      retryEl
    );
  } else {
    // Clear: remove existing FailedJobRetryTimeCycle extension element
    const extensionElements = bo.extensionElements;
    if (extensionElements?.values) {
      extensionElements.values = extensionElements.values.filter(
        (v: any) => v.$type !== 'camunda:FailedJobRetryTimeCycle'
      );
      modeling.updateProperties(element, { extensionElements });
    }
  }
}

/**
 * Handle `camunda:connector` — creates/removes a camunda:Connector extension element
 * with connectorId and optional nested inputOutput.
 *
 * Expected format: `{ connectorId: string, inputOutput?: { inputParameters?: [...], outputParameters?: [...] } }`
 * Set to `null` or empty object to remove.
 * Mutates `camundaProps` in-place (deletes the key after processing).
 */
function handleConnector(element: any, camundaProps: Record<string, any>, diagram: any): void {
  if (!('camunda:connector' in camundaProps)) return;

  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const bo = element.businessObject;
  const connectorDef = camundaProps['camunda:connector'];
  delete camundaProps['camunda:connector'];

  if (connectorDef == null || (typeof connectorDef === 'object' && !connectorDef.connectorId)) {
    // Remove existing Connector
    const extensionElements = bo.extensionElements;
    if (extensionElements?.values) {
      extensionElements.values = extensionElements.values.filter(
        (v: any) => v.$type !== 'camunda:Connector'
      );
      modeling.updateProperties(element, { extensionElements });
    }
    return;
  }

  const connectorAttrs: Record<string, any> = {
    connectorId: connectorDef.connectorId,
  };

  // Build nested InputOutput if provided
  if (connectorDef.inputOutput) {
    const ioAttrs: Record<string, any> = {};
    if (connectorDef.inputOutput.inputParameters) {
      ioAttrs.inputParameters = connectorDef.inputOutput.inputParameters.map(
        (p: { name: string; value?: string }) =>
          moddle.create('camunda:InputParameter', { name: p.name, value: p.value })
      );
    }
    if (connectorDef.inputOutput.outputParameters) {
      ioAttrs.outputParameters = connectorDef.inputOutput.outputParameters.map(
        (p: { name: string; value?: string }) =>
          moddle.create('camunda:OutputParameter', { name: p.name, value: p.value })
      );
    }
    connectorAttrs.inputOutput = moddle.create('camunda:InputOutput', ioAttrs);
  }

  const connectorEl = moddle.create('camunda:Connector', connectorAttrs);
  upsertExtensionElement(moddle, bo, modeling, element, 'camunda:Connector', connectorEl);
}

/**
 * Handle `camunda:field` — creates camunda:Field extension elements on ServiceTaskLike elements.
 *
 * Expected format: array of `{ name: string, stringValue?: string, string?: string, expression?: string }`
 * Set to `null` or empty array to remove all fields.
 * Mutates `camundaProps` in-place (deletes the key after processing).
 */
function handleField(element: any, camundaProps: Record<string, any>, diagram: any): void {
  if (!('camunda:field' in camundaProps)) return;

  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const bo = element.businessObject;
  const fields = camundaProps['camunda:field'];
  delete camundaProps['camunda:field'];

  // Ensure extensionElements container exists
  let extensionElements = bo.extensionElements;
  if (!extensionElements) {
    extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    extensionElements.$parent = bo;
  }

  // Remove existing Field entries
  extensionElements.values = (extensionElements.values || []).filter(
    (v: any) => v.$type !== 'camunda:Field'
  );

  if (fields && Array.isArray(fields) && fields.length > 0) {
    for (const f of fields) {
      const attrs: Record<string, any> = { name: f.name };
      if (f.stringValue != null) attrs.stringValue = f.stringValue;
      if (f.string != null) attrs.string = f.string;
      if (f.expression != null) attrs.expression = f.expression;
      const fieldEl = moddle.create('camunda:Field', attrs);
      fieldEl.$parent = extensionElements;
      extensionElements.values.push(fieldEl);
    }
  }

  modeling.updateProperties(element, { extensionElements });
}

/**
 * Handle `camunda:properties` — creates camunda:Properties extension element with
 * camunda:Property children for generic key-value metadata.
 *
 * Expected format: `Record<string, string>` (key-value pairs).
 * Set to `null` or empty object to remove.
 * Mutates `camundaProps` in-place (deletes the key after processing).
 */
function handleProperties(element: any, camundaProps: Record<string, any>, diagram: any): void {
  if (!('camunda:properties' in camundaProps)) return;

  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const bo = element.businessObject;
  const propsMap = camundaProps['camunda:properties'];
  delete camundaProps['camunda:properties'];

  if (propsMap == null || (typeof propsMap === 'object' && Object.keys(propsMap).length === 0)) {
    // Remove existing Properties
    const extensionElements = bo.extensionElements;
    if (extensionElements?.values) {
      extensionElements.values = extensionElements.values.filter(
        (v: any) => v.$type !== 'camunda:Properties'
      );
      modeling.updateProperties(element, { extensionElements });
    }
    return;
  }

  const propertyValues = Object.entries(propsMap).map(([name, value]) =>
    moddle.create('camunda:Property', { name, value: String(value) })
  );

  const propertiesEl = moddle.create('camunda:Properties', { values: propertyValues });
  upsertExtensionElement(moddle, bo, modeling, element, 'camunda:Properties', propertiesEl);
}

// ── Main handler ───────────────────────────────────────────────────────────

/**
 * Apply standard and camunda properties to an element.
 * Handles special cases: retryTimeCycle, connector, field, properties,
 * script properties, documentation, and empty-string camunda attribute skipping.
 * Returns the (possibly updated) camundaProps for hint building.
 */
function applyPropsToElement(
  element: any,
  standardProps: Record<string, any>,
  camundaProps: Record<string, any>,
  diagram: ReturnType<typeof requireDiagram>
): void {
  const modeling = getService(diagram.modeler, 'modeling');

  // Handle `camunda:retryTimeCycle` — creates camunda:FailedJobRetryTimeCycle extension element
  handleRetryTimeCycle(element, camundaProps, diagram);
  // Handle `camunda:connector` — creates camunda:Connector extension element
  handleConnector(element, camundaProps, diagram);
  // Handle `camunda:field` — creates camunda:Field extension elements
  handleField(element, camundaProps, diagram);
  // Handle `camunda:properties` — creates camunda:Properties extension element
  handleProperties(element, camundaProps, diagram);
  // Handle script-related properties (scriptFormat, script, camunda:resource) on ScriptTasks
  handleScriptProperties(element, standardProps, camundaProps, diagram);

  // Handle `documentation` — creates/updates bpmn:documentation child element
  if ('documentation' in standardProps) {
    const moddle = getService(diagram.modeler, 'moddle');
    const bo = element.businessObject;
    const docText = standardProps['documentation'];
    delete standardProps['documentation'];
    if (docText != null && docText !== '') {
      const docElement = moddle.create('bpmn:Documentation', { text: String(docText) });
      docElement.$parent = bo;
      bo.documentation = [docElement];
      modeling.updateProperties(element, { documentation: bo.documentation });
    } else {
      bo.documentation = [];
      modeling.updateProperties(element, { documentation: bo.documentation });
    }
  }

  if (Object.keys(standardProps).length > 0) {
    modeling.updateProperties(element, standardProps);
  }

  // Strip empty-string camunda extension attributes — they are misleading
  // in the XML (e.g. camunda:dueDate="") and should simply be omitted.
  const nonEmptyCamundaProps: Record<string, any> = {};
  for (const [key, value] of Object.entries(camundaProps)) {
    if (value !== '') nonEmptyCamundaProps[key] = value;
  }
  if (Object.keys(nonEmptyCamundaProps).length > 0) {
    modeling.updateProperties(element, nonEmptyCamundaProps);
  }
}

/**
 * Apply the standard `properties` map (if non-empty) to `element`, handling
 * the gateway `default`, `conditionExpression`, and Camunda-attribute
 * special cases. Returns the (possibly replaced, e.g. via isExpanded)
 * element along with hints and the list of applied property keys.
 */
function applyStandardProperties(
  element: any,
  props: Record<string, any>,
  diagram: ReturnType<typeof requireDiagram>,
  elementRegistry: any,
  modeling: any
): { element: any; hints: ReturnType<typeof buildPropertyHints>; updatedPropertyKeys: string[] } {
  if (Object.keys(props).length === 0) {
    return { element, hints: [], updatedPropertyKeys: [] };
  }

  const updatedElement = handleIsExpandedOnSubProcess(element, props, diagram);

  const standardProps: Record<string, any> = {};
  const camundaProps: Record<string, any> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('camunda:')) camundaProps[key] = value;
    else standardProps[key] = value;
  }

  // Auto-set camunda:type="external" when camunda:topic is provided
  if (camundaProps['camunda:topic'] && !camundaProps['camunda:type']) {
    camundaProps['camunda:type'] = 'external';
  }

  handleDefaultOnGateway(updatedElement, standardProps, elementRegistry, modeling);
  handleConditionExpression(standardProps, getService(diagram.modeler, 'moddle'));

  applyPropsToElement(updatedElement, standardProps, camundaProps, diagram);

  return {
    element: updatedElement,
    hints: buildPropertyHints(props, camundaProps, updatedElement),
    updatedPropertyKeys: Object.keys(props),
  };
}

// ── Batch (`updates`) form ───────────────────────────────────────────────────

interface UpdateItemResult {
  elementId: string;
  originalElementId?: string;
  changed: string[];
  hints: Array<{ tool: string; description: string }>;
}

/** Throws unless at least one concern is present on the item. */
function assertUpdateItemHasConcern(item: SetPropertiesUpdateItem, label: string): void {
  const hasSubObjects = !!(
    item.inputOutput ||
    item.formData ||
    item.listeners ||
    item.callActivityVariables ||
    item.loop ||
    item.eventDefinition
  );
  const hasProps = !!(item.properties && Object.keys(item.properties).length > 0);
  if (!item.elementType && !hasProps && !hasSubObjects) {
    throw semanticViolationError(
      `${label}: at least one of properties, elementType, inputOutput, formData, listeners, ` +
        'callActivityVariables, loop, or eventDefinition is required'
    );
  }
}

/**
 * Validate `item.elementType` (if present) without mutating anything, and
 * return the type the element will have once applied (its current type when
 * no replacement is requested).
 */
function validateAndResolveEffectiveType(
  item: SetPropertiesUpdateItem,
  currentType: string,
  label: string
): string {
  if (!item.elementType) return currentType;

  if (item.elementType === 'bpmn:BoundaryEvent' || currentType === 'bpmn:BoundaryEvent') {
    throw semanticViolationError(
      `${label}: cannot replace an element to/from bpmn:BoundaryEvent via elementType`
    );
  }
  if (currentType !== item.elementType && !REPLACEABLE_TYPES.has(item.elementType)) {
    throw semanticViolationError(
      `${label}: elementType '${item.elementType}' is not a supported replacement type`
    );
  }
  return item.elementType;
}

/**
 * Throws unless every sub-object concern on the item targets a compatible
 * element type. Also runs eventDefinition's full (side-effect-free) argument
 * validation, since that sub-object's failure modes go beyond target type.
 */
function assertUpdateItemSubObjectTargets(
  item: SetPropertiesUpdateItem,
  effectiveType: string,
  label: string
): void {
  try {
    if (item.formData) assertFormDataTarget(effectiveType, item.elementId);
    if (item.listeners?.taskListeners?.length) {
      assertTaskListenerTarget(effectiveType, item.elementId);
    }
    if (item.listeners?.errorDefinitions?.length) {
      assertErrorDefinitionTarget(effectiveType, item.elementId);
    }
    if (item.callActivityVariables) assertCallActivityTarget(effectiveType, item.elementId);
    if (item.loop) assertLoopTarget(effectiveType, item.elementId);
    if (item.eventDefinition) {
      assertEventDefinitionTarget(effectiveType, item.elementId);
      validateEventDefinitionArgs(item.eventDefinition);
    }
  } catch (err) {
    throw semanticViolationError(`${label}: ${(err as Error).message}`);
  }
}

/**
 * Validate one `updates[]` item without mutating anything: the element
 * exists, at least one concern is present, and (when known cheaply, i.e.
 * without actually attempting the mutation) the element/target type is
 * compatible with every sub-object requested. Run over every item before any
 * item is applied, so a bad item fails the whole call with nothing changed.
 */
function preValidateUpdateItem(
  elementRegistry: any,
  item: SetPropertiesUpdateItem,
  index: number
): void {
  const label = `updates[${index}] (elementId: ${item.elementId})`;
  let element: any;
  try {
    element = requireElement(elementRegistry, item.elementId);
  } catch (err) {
    throw semanticViolationError(`${label}: ${(err as Error).message}`);
  }

  assertUpdateItemHasConcern(item, label);

  const currentType = element.type || element.businessObject?.$type || '';
  const effectiveType = validateAndResolveEffectiveType(item, currentType, label);
  assertUpdateItemSubObjectTargets(item, effectiveType, label);
}

/**
 * Apply one `updates[]` item's concerns to its element. Synchronous — calls
 * only the synchronous `*Core` mutators (no XML sync, no lint) — so that a
 * whole batch of these, run inside one command-stack `preExecute`, get
 * grouped into a single undo step (see `ensureBatchUpdateCommand` below).
 */
function applyPropertyUpdateItem(
  diagram: ReturnType<typeof requireDiagram>,
  elementRegistry: any,
  modeling: any,
  item: SetPropertiesUpdateItem
): UpdateItemResult {
  let element = requireElement(elementRegistry, item.elementId);
  let elementId = element.id;
  const changed: string[] = [];

  if (item.elementType) {
    const { element: replaced, unchanged } = replaceElementCore(
      diagram,
      elementId,
      item.elementType
    );
    if (!unchanged) {
      element = replaced;
      elementId = replaced.id;
      changed.push('elementType');
    }
  }

  const applied = applyStandardProperties(
    element,
    item.properties ?? {},
    diagram,
    elementRegistry,
    modeling
  );
  element = applied.element;
  elementId = element.id;
  if (applied.updatedPropertyKeys.length > 0) changed.push('properties');

  let hints = applied.hints;

  if (item.inputOutput) {
    applySetInputOutputCore(diagram, elementId, item.inputOutput);
    changed.push('inputOutput');
  }
  if (item.formData) {
    applySetFormDataCore(diagram, elementId, item.formData as any);
    changed.push('formData');
  }
  if (item.listeners) {
    applySetCamundaListenersCore(diagram, elementId, item.listeners as any);
    changed.push('listeners');
  }
  if (item.callActivityVariables) {
    applySetCallActivityVariablesCore(diagram, elementId, item.callActivityVariables);
    changed.push('callActivityVariables');
  }
  if (item.loop) {
    const loopResult = applySetLoopCharacteristicsCore(diagram, elementId, item.loop);
    hints = [...hints, ...loopResult.hints];
    changed.push('loop');
  }
  if (item.eventDefinition) {
    applySetEventDefinitionCore(diagram, elementId, item.eventDefinition);
    changed.push('eventDefinition');
  }

  return {
    elementId,
    ...(item.elementId !== elementId ? { originalElementId: item.elementId } : {}),
    changed,
    hints,
  };
}

interface BatchUpdateContext {
  diagram: ReturnType<typeof requireDiagram>;
  elementRegistry: any;
  modeling: any;
  items: SetPropertiesUpdateItem[];
  results: UpdateItemResult[];
  error?: Error;
}

const BATCH_UPDATE_COMMAND = 'bpmn-mcp.applyPropertyUpdates';

/**
 * Register (once per modeler) the compound command that applies every
 * `updates[]` item's mutations inside one `preExecute` call. Because all
 * nested `modeling`/`bpmnReplace` calls happen synchronously within that one
 * call, the command stack groups them (plus this wrapper command itself)
 * under a single id, so the whole batch undoes/redoes as one step — the same
 * technique `auto-layout.ts` uses for `layout_bpmn_diagram`.
 *
 * `preExecute` never throws: an item failure is caught and stashed on
 * `ctx.error` instead, so the command stack's own bookkeeping (which does not
 * tolerate a `preExecute` exception) stays consistent. The caller checks
 * `ctx.error` after `commandStack.execute()` returns and, if set, unwinds the
 * whole batch via `commandStack.undo()`.
 */
function ensureBatchUpdateCommand(modeler: any): void {
  const commandStack = getService(modeler, 'commandStack') as any;
  if (commandStack._getHandler?.(BATCH_UPDATE_COMMAND)) return;

  commandStack.registerHandler(
    BATCH_UPDATE_COMMAND,
    function ApplyPropertyUpdatesHandler(this: any) {
      this.preExecute = (ctx: BatchUpdateContext) => {
        try {
          for (const item of ctx.items) {
            ctx.results.push(
              applyPropertyUpdateItem(ctx.diagram, ctx.elementRegistry, ctx.modeling, item)
            );
          }
        } catch (err) {
          ctx.error = err as Error;
        }
      };
      this.execute = () => [];
      this.revert = () => [];
    }
  );
}

async function handleSetPropertiesBatch(
  diagramId: string,
  updates: SetPropertiesUpdateItem[]
): Promise<ToolResult> {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw missingRequiredError(['updates']);
  }

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');

  updates.forEach((item, index) => {
    validateArgs(item, ['elementId']);
    preValidateUpdateItem(elementRegistry, item, index);
  });

  const commandStack = getService(diagram.modeler, 'commandStack') as any;
  const startIdx = commandStack._stackIdx ?? 0;
  ensureBatchUpdateCommand(diagram.modeler);

  const ctx: BatchUpdateContext = {
    diagram,
    elementRegistry,
    modeling,
    items: updates,
    results: [],
  };
  commandStack.execute(BATCH_UPDATE_COMMAND, ctx);

  if (ctx.error) {
    while ((commandStack._stackIdx ?? 0) > startIdx && commandStack.canUndo()) {
      commandStack.undo();
    }
    throw semanticViolationError(
      `Batch update failed: ${ctx.error.message}. No changes were applied.`
    );
  }

  await syncXml(diagram);

  const mergedHints: Array<{ tool: string; description: string }> = [];
  const seenHints = new Set<string>();
  for (const item of ctx.results) {
    for (const hint of item.hints) {
      const key = JSON.stringify(hint);
      if (seenHints.has(key)) continue;
      seenHints.add(key);
      mergedHints.push(hint);
    }
  }

  const result = jsonResult({
    success: true,
    updated: ctx.results.map(({ elementId, originalElementId, changed }) => ({
      elementId,
      ...(originalElementId ? { originalElementId } : {}),
      changed,
    })),
    message: `Updated ${ctx.results.length} element(s)`,
    ...(mergedHints.length > 0 ? { nextSteps: mergedHints } : {}),
  });
  return appendLintFeedback(result, diagram);
}

export async function handleSetProperties(args: SetPropertiesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);

  if (args.updates) {
    return handleSetPropertiesBatch(args.diagramId, args.updates);
  }

  validateArgs(args, ['elementId']);
  return handleSetPropertiesSingle(args);
}

/** Whether `args` has any non-elementType concern to apply (properties or a sub-object). */
function hasNonTypeConcern(args: SetPropertiesArgs): boolean {
  return (
    Object.keys(args.properties ?? {}).length > 0 ||
    !!(
      args.inputOutput ||
      args.formData ||
      args.listeners ||
      args.callActivityVariables ||
      args.loop ||
      args.eventDefinition
    )
  );
}

/**
 * Replace the element's type first, then recurse to apply the rest of `args`
 * (properties/sub-objects) to the (possibly renamed) element, merging `newType`
 * into the final response.
 */
async function handleElementTypeReplacement(
  diagramId: string,
  elementId: string,
  args: SetPropertiesArgs
): Promise<ToolResult> {
  const replaceResult = await handleReplaceElement({
    diagramId,
    elementId,
    newType: args.elementType!,
  });
  if (!hasNonTypeConcern(args)) return replaceResult;

  const replaceData = JSON.parse(replaceResult.content[0].text as string);
  const newElementId = replaceData.elementId || elementId;
  const updatedArgs = { ...args, elementId: newElementId, elementType: undefined };
  const propsResult = await handleSetPropertiesSingle(updatedArgs);
  const propsData = JSON.parse(propsResult.content[0].text as string);
  return jsonResult({ ...propsData, newType: args.elementType });
}

async function handleSetPropertiesSingle(args: SetPropertiesArgs): Promise<ToolResult> {
  const { diagramId } = args;
  const elementId = args.elementId as string;
  const props = args.properties ?? {};

  if (!args.elementType && !hasNonTypeConcern(args)) {
    throw missingRequiredError(['properties']);
  }

  if (args.elementType) {
    return handleElementTypeReplacement(diagramId, elementId, args);
  }

  const diagram = requireDiagram(diagramId);
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const initialElement = requireElement(elementRegistry, elementId);
  const { element, hints, updatedPropertyKeys } = applyStandardProperties(
    initialElement,
    props,
    diagram,
    elementRegistry,
    modeling
  );

  // Delegate any Camunda-concern sub-objects (inputOutput, formData, listeners,
  // callActivityVariables, loop) to their dedicated handlers.
  const sections = await applySubObjectDelegates(args, diagramId, element.id);
  const appliedSections = sections ? Object.keys(sections) : [];

  await syncXml(diagram);

  const messageParts = [
    ...(updatedPropertyKeys.length > 0 ? ['properties'] : []),
    ...appliedSections,
  ];
  const combinedNextSteps = [...hints, ...(sections ? mergeSectionNextSteps(sections) : [])];

  const result = jsonResult({
    success: true,
    elementId: element.id,
    ...(updatedPropertyKeys.length > 0
      ? {
          updated: [{ id: element.id, changed: updatedPropertyKeys }],
          updatedProperties: updatedPropertyKeys,
        }
      : {}),
    ...(sections ? { updatedSections: appliedSections, sections } : {}),
    message: `Updated ${messageParts.join(', ')} on ${element.id}`,
    ...(element.id !== elementId
      ? { note: `Element ID changed from ${elementId} to ${element.id}` }
      : {}),
    ...(combinedNextSteps.length > 0 ? { nextSteps: combinedNextSteps } : {}),
  });
  return appendLintFeedback(result, diagram);
}

/** Per-element concern properties, shared between the single-element form and each `updates[]` item. */
const ELEMENT_TYPE_SCHEMA = {
  type: 'string',
  description:
    'Optional element type to replace the element with (e.g. "bpmn:UserTask", "bpmn:ServiceTask"). ' +
    'When provided, replaces the element type before setting properties.',
  enum: [
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
    'bpmn:StartEvent',
    'bpmn:EndEvent',
    'bpmn:SubProcess',
  ],
} as const;

const CONCERN_SCHEMA_PROPERTIES = {
  properties: {
    type: 'object',
    description:
      "Key-value pairs of properties to set. Use 'camunda:' prefix for Camunda extension attributes (e.g. { 'camunda:assignee': 'john', 'camunda:formKey': 'embedded:app:forms/task.html' }).",
    additionalProperties: true,
  },
  elementType: ELEMENT_TYPE_SCHEMA,
  inputOutput: {
    type: 'object',
    description:
      'Camunda input/output parameter mapping (camunda:InputOutput). ' +
      'Equivalent to the former set_bpmn_input_output_mapping tool.',
    properties: IO_PARAMETERS_SCHEMA_PROPERTIES,
  },
  formData: {
    type: 'object',
    description:
      'Generated task form fields (camunda:FormData) for UserTasks/StartEvents. ' +
      'Equivalent to the former set_bpmn_form_data tool.',
    properties: FORM_DATA_SCHEMA_PROPERTIES,
    required: ['fields'],
  },
  listeners: {
    type: 'object',
    description:
      'Execution listeners, task listeners, and/or error event definitions. ' +
      'Equivalent to the former set_bpmn_camunda_listeners tool.',
    properties: CAMUNDA_LISTENERS_SCHEMA_PROPERTIES,
  },
  callActivityVariables: {
    type: 'object',
    description:
      'CallActivity in/out variable mappings (camunda:in / camunda:out). ' +
      'Equivalent to the former set_bpmn_call_activity_variables tool.',
    properties: CALL_ACTIVITY_VARIABLES_SCHEMA_PROPERTIES,
  },
  loop: {
    type: 'object',
    description:
      'Loop/multi-instance characteristics on tasks, subprocesses, or call activities. ' +
      'Equivalent to the former set_bpmn_loop_characteristics tool.',
    properties: LOOP_CHARACTERISTICS_SCHEMA_PROPERTIES,
    required: ['loopType'],
  },
  eventDefinition: {
    type: 'object',
    description:
      'Event definition to add/replace on an event element (StartEvent, EndEvent, ' +
      'IntermediateCatchEvent/ThrowEvent, BoundaryEvent).',
    properties: EVENT_DEFINITION_SCHEMA_PROPERTIES,
    required: ['eventDefinitionType'],
  },
} as const;

/**
 * Lean per-item concern schema for `updates[]`. Reuses `properties` and
 * `elementType` verbatim, but points at the top-level `inputOutput`/`formData`/
 * `listeners`/`callActivityVariables`/`loop` fields for their shape instead of
 * re-inlining the (large) nested schemas — keeping the tool definition within
 * the size budget (see test/tool-definitions.test.ts).
 */
const UPDATE_ITEM_CONCERN_PROPERTIES = {
  properties: CONCERN_SCHEMA_PROPERTIES.properties,
  elementType: ELEMENT_TYPE_SCHEMA,
  inputOutput: {
    type: 'object',
    description: 'Same shape as the top-level inputOutput field.',
  },
  formData: {
    type: 'object',
    description: 'Same shape as the top-level formData field (fields is required).',
  },
  listeners: {
    type: 'object',
    description: 'Same shape as the top-level listeners field.',
  },
  callActivityVariables: {
    type: 'object',
    description: 'Same shape as the top-level callActivityVariables field.',
  },
  loop: {
    type: 'object',
    description: 'Same shape as the top-level loop field (loopType is required).',
  },
  eventDefinition: {
    type: 'object',
    description:
      'Same shape as the top-level eventDefinition field (eventDefinitionType is required).',
  },
} as const;

export const TOOL_DEFINITION = {
  name: 'set_bpmn_element_properties',
  description:
    'Set BPMN or Camunda extension properties on an element. ' +
    'Supports standard properties (name, isExecutable, documentation, default, conditionExpression) ' +
    'and Camunda extensions with camunda: prefix (e.g. camunda:assignee, camunda:class, camunda:type, camunda:topic). ' +
    'Also handles: scriptFormat/script on ScriptTask, camunda:connector, camunda:field, camunda:properties, ' +
    'camunda:retryTimeCycle, isExpanded on SubProcess, and cancelActivity on BoundaryEvent (false = non-interrupting). ' +
    'See bpmn://guides/element-properties for the full property catalog by element type. ' +
    'Supports optional elementType to replace the element type (e.g. bpmn:Task → bpmn:UserTask). ' +
    'Also accepts optional sub-objects for other concerns, settable together with properties in one ' +
    'call: inputOutput, formData, listeners, callActivityVariables, loop, eventDefinition. ' +
    'To update several elements in one call — e.g. setting camunda:assignee on every task in an ' +
    'executable process — pass `updates: [{ elementId, properties, ... }]` instead of the single-element ' +
    'elementId/properties/etc. fields. Every item is validated before any element is changed, and the whole ' +
    'batch applies as one undo step.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to update. Required unless `updates` is used instead.',
      },
      ...CONCERN_SCHEMA_PROPERTIES,
      updates: {
        type: 'array',
        description:
          'Batch form: apply properties/elementType/sub-objects to several elements in one call, as a ' +
          'single undo step. Alternative to the single-element elementId (+ properties/elementType/...) ' +
          'fields above — do not combine elementId with updates.',
        items: {
          type: 'object',
          properties: {
            elementId: { type: 'string', description: 'The ID of the element to update' },
            ...UPDATE_ITEM_CONCERN_PROPERTIES,
          },
          required: ['elementId'],
        },
      },
    },
    required: ['diagramId'],
  },
} as const;
