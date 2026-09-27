/**
 * Handler for set_element_properties tool.
 *
 * Automatically sets camunda:type="external" when camunda:topic is provided
 * without an explicit camunda:type value, mirroring Camunda Modeler behavior.
 *
 * Supports the `default` attribute on gateways by resolving the sequence flow
 * business object from a string ID.
 *
 * Also accepts optional inputOutput/formData/listeners/callActivityVariables/loop
 * sub-objects, delegating to the respective dedicated handler for each
 * (see ADR-021 — set_bpmn_element_properties as the Camunda-setter facade).
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
import { missingRequiredError } from '../../errors';
import { appendLintFeedback } from '../../linter';
import { handleScriptProperties } from './set-script-properties';
import { handleReplaceElement } from '../elements/replace-element';
import {
  handleSetInputOutput,
  IO_PARAMETERS_SCHEMA_PROPERTIES,
  type IoParameterValue,
} from './set-input-output';
import { handleSetFormData, FORM_DATA_SCHEMA_PROPERTIES } from './set-form-data';
import { handleSetCamundaListeners } from './set-camunda-listeners';
import { CAMUNDA_LISTENERS_SCHEMA_PROPERTIES } from './set-camunda-listeners-schema';
import {
  handleSetCallActivityVariables,
  CALL_ACTIVITY_VARIABLES_SCHEMA_PROPERTIES,
} from './set-call-activity-variables';
import {
  handleSetLoopCharacteristics,
  LOOP_CHARACTERISTICS_SCHEMA_PROPERTIES,
} from './set-loop-characteristics';

export interface SetPropertiesArgs {
  diagramId: string;
  elementId: string;
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
}

/** The five Camunda-concern sub-objects, in the order they're applied. */
const SUB_OBJECT_DELEGATES = [
  { key: 'inputOutput', handler: handleSetInputOutput },
  { key: 'formData', handler: handleSetFormData },
  { key: 'listeners', handler: handleSetCamundaListeners },
  { key: 'callActivityVariables', handler: handleSetCallActivityVariables },
  { key: 'loop', handler: handleSetLoopCharacteristics },
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

export async function handleSetProperties(args: SetPropertiesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId } = args;
  const props = args.properties ?? {};
  const hasSubObjects = !!(
    args.inputOutput ||
    args.formData ||
    args.listeners ||
    args.callActivityVariables ||
    args.loop
  );

  if (!args.elementType && Object.keys(props).length === 0 && !hasSubObjects) {
    throw missingRequiredError(['properties']);
  }

  // If elementType is provided, delegate to replace handler first
  if (args.elementType) {
    const replaceResult = await handleReplaceElement({
      diagramId,
      elementId,
      newType: args.elementType,
    });
    const replaceData = JSON.parse(replaceResult.content[0].text as string);
    // If nothing else to apply, return the replace result
    if (Object.keys(props).length === 0 && !hasSubObjects) {
      return replaceResult;
    }
    // Use the new element ID for subsequent property setting (may have changed)
    const newElementId = replaceData.elementId || elementId;
    const updatedArgs = { ...args, elementId: newElementId, elementType: undefined };
    const propsResult = await handleSetProperties(updatedArgs);
    // Merge newType into the final result so callers can see the type change
    const propsData = JSON.parse(propsResult.content[0].text as string);
    return jsonResult({ ...propsData, newType: args.elementType });
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
    'Also accepts optional sub-objects for other Camunda concerns, settable together with properties ' +
    'in one call: inputOutput, formData, listeners, callActivityVariables, loop.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to update',
      },
      properties: {
        type: 'object',
        description:
          "Key-value pairs of properties to set. Use 'camunda:' prefix for Camunda extension attributes (e.g. { 'camunda:assignee': 'john', 'camunda:formKey': 'embedded:app:forms/task.html' }).",
        additionalProperties: true,
      },
      elementType: {
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
      },
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
    },
    required: ['diagramId', 'elementId'],
  },
} as const;
