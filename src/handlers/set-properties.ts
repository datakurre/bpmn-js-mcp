/**
 * Handler for set_element_properties tool.
 *
 * Automatically sets camunda:type="external" when camunda:topic is provided
 * without an explicit camunda:type value, mirroring Camunda Modeler behavior.
 *
 * Supports the `default` attribute on gateways by resolving the sequence flow
 * business object from a string ID.
 *
 * For loop characteristics, use the dedicated set_loop_characteristics tool.
 */

import { type ToolResult } from '../types';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  upsertExtensionElement,
} from './helpers';
import { appendLintFeedback } from '../linter';

export interface SetPropertiesArgs {
  diagramId: string;
  elementId: string;
  properties: Record<string, any>;
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
    const bpmnReplace = diagram.modeler.get('bpmnReplace');
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

  const moddle = diagram.modeler.get('moddle');
  const modeling = diagram.modeler.get('modeling');
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

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleSetProperties(args: SetPropertiesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'properties']);
  const { diagramId, elementId, properties: props } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  let element = requireElement(elementRegistry, elementId);

  element = handleIsExpandedOnSubProcess(element, props, diagram);

  const standardProps: Record<string, any> = {};
  const camundaProps: Record<string, any> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('camunda:')) {
      camundaProps[key] = value;
    } else {
      standardProps[key] = value;
    }
  }

  // Auto-set camunda:type="external" when camunda:topic is provided
  if (camundaProps['camunda:topic'] && !camundaProps['camunda:type']) {
    camundaProps['camunda:type'] = 'external';
  }

  handleDefaultOnGateway(element, standardProps, elementRegistry, modeling);
  handleConditionExpression(standardProps, diagram.modeler.get('moddle'));

  // Handle `camunda:retryTimeCycle` — creates camunda:FailedJobRetryTimeCycle extension element
  handleRetryTimeCycle(element, camundaProps, diagram);

  // Handle `documentation` — creates/updates bpmn:documentation child element
  if ('documentation' in standardProps) {
    const moddle = diagram.modeler.get('moddle');
    const bo = element.businessObject;
    const docText = standardProps['documentation'];
    delete standardProps['documentation'];

    if (docText != null && docText !== '') {
      const docElement = moddle.create('bpmn:Documentation', { text: String(docText) });
      docElement.$parent = bo;
      bo.documentation = [docElement];
      modeling.updateProperties(element, { documentation: bo.documentation });
    } else {
      // Clear documentation
      bo.documentation = [];
      modeling.updateProperties(element, { documentation: bo.documentation });
    }
  }

  if (Object.keys(standardProps).length > 0) {
    modeling.updateProperties(element, standardProps);
  }
  if (Object.keys(camundaProps).length > 0) {
    modeling.updateProperties(element, camundaProps);
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId: element.id,
    updatedProperties: Object.keys(args.properties),
    message: `Updated properties on ${element.id}`,
    ...(element.id !== elementId
      ? { note: `Element ID changed from ${elementId} to ${element.id}` }
      : {}),
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_element_properties',
  description:
    "Set BPMN or Camunda extension properties on an element. Supports standard properties (name, isExecutable, documentation) and Camunda extensions (e.g. camunda:assignee, camunda:candidateUsers, camunda:candidateGroups, camunda:formKey, camunda:class, camunda:delegateExpression, camunda:expression, camunda:asyncBefore, camunda:asyncAfter, camunda:topic, camunda:type). UserTask-specific: camunda:dueDate, camunda:followUpDate, camunda:priority. Process-specific: camunda:historyTimeToLive, camunda:candidateStarterGroups, camunda:candidateStarterUsers, camunda:versionTag, camunda:isStartableInTasklist. CallActivity: camunda:calledElementBinding, camunda:calledElementVersion, camunda:calledElementVersionTag. BusinessRuleTask (DMN): camunda:decisionRef, camunda:decisionRefBinding, camunda:mapDecisionResult. StartEvent: camunda:initiator. Supports camunda:retryTimeCycle to create a camunda:FailedJobRetryTimeCycle extension element (e.g. 'R3/PT10M'). Supports `default` attribute on exclusive/inclusive gateways (pass a sequence flow ID to mark it as the default flow). Supports `conditionExpression` on sequence flows (pass a string expression e.g. '${approved == true}'). Supports `isExpanded` on SubProcess elements — properly toggles between expanded (inline children) and collapsed (drilldown plane) via element replacement. For loop characteristics, use the dedicated set_loop_characteristics tool.",
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
    },
    required: ['diagramId', 'elementId', 'properties'],
  },
} as const;
