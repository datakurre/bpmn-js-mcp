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

import { type SetPropertiesArgs, type ToolResult } from '../types';
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from './helpers';
import { appendLintFeedback } from '../linter';

// ── Sub-functions for special-case property handling ───────────────────────

/**
 * Handle `default` property on gateways — requires a BO reference, not a string.
 * Mutates `standardProps` in-place (deletes the key after direct BO assignment).
 */
function handleDefaultOnGateway(
  element: any,
  standardProps: Record<string, any>,
  elementRegistry: any
): void {
  if (standardProps['default'] == null) return;

  const elType = element.type || element.businessObject?.$type || '';
  if (!elType.includes('ExclusiveGateway') && !elType.includes('InclusiveGateway')) return;

  const flowId = standardProps['default'];
  if (typeof flowId === 'string') {
    const flowEl = elementRegistry.get(flowId);
    if (flowEl) {
      element.businessObject.default = flowEl.businessObject;
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

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleSetProperties(args: SetPropertiesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'properties']);
  const { diagramId, elementId, properties: props } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  const element = requireElement(elementRegistry, elementId);

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

  handleDefaultOnGateway(element, standardProps, elementRegistry);
  handleConditionExpression(standardProps, diagram.modeler.get('moddle'));

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
    elementId,
    updatedProperties: Object.keys(props),
    message: `Updated properties on ${elementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_element_properties',
  description:
    "Set BPMN or Camunda extension properties on an element. Supports standard properties (name, isExecutable) and Camunda extensions (e.g. camunda:assignee, camunda:formKey, camunda:class, camunda:delegateExpression, camunda:asyncBefore, camunda:topic, camunda:type). Supports `default` attribute on exclusive/inclusive gateways (pass a sequence flow ID to mark it as the default flow). Supports `conditionExpression` on sequence flows (pass a string expression e.g. '${approved == true}'). For loop characteristics, use the dedicated set_loop_characteristics tool.",
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
