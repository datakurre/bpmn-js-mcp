/**
 * Handler for set_form_data tool.
 *
 * Creates `camunda:FormData` with `camunda:FormField` children as extension
 * elements on User Tasks and Start Events.  This produces "Generated Task
 * Forms" (as opposed to "Embedded or External Task Forms" via formKey).
 */

import { type ToolResult } from '../../types';
import { typeMismatchError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  upsertExtensionElement,
  validateArgs,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface SetFormDataArgs {
  diagramId: string;
  elementId: string;
  businessKey?: string;
  fields: Array<{
    id: string;
    label: string;
    type: string;
    defaultValue?: string;
    datePattern?: string;
    properties?: Record<string, string>;
    validation?: Array<{ name: string; config?: string }>;
    values?: Array<{ id: string; name: string }>;
  }>;
}

export async function handleSetFormData(args: SetFormDataArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'fields']);
  const { diagramId, elementId, businessKey, fields } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const moddle = diagram.modeler.get('moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  // Verify element is a UserTask or StartEvent
  if (bo.$type !== 'bpmn:UserTask' && bo.$type !== 'bpmn:StartEvent') {
    throw typeMismatchError(elementId, bo.$type, ['bpmn:UserTask', 'bpmn:StartEvent']);
  }

  // Build camunda:FormField elements
  const formFields = fields.map((f) => {
    const fieldAttrs: Record<string, any> = {
      id: f.id,
      label: f.label,
      type: f.type,
    };
    if (f.defaultValue !== undefined) fieldAttrs.defaultValue = f.defaultValue;
    if (f.datePattern !== undefined) fieldAttrs.datePattern = f.datePattern;

    // Enum values (camunda:Value entries)
    if (f.values?.length) {
      fieldAttrs.values = f.values.map((v) =>
        moddle.create('camunda:Value', { id: v.id, name: v.name })
      );
    }

    // Validation constraints (camunda:Validation > camunda:Constraint)
    if (f.validation?.length) {
      const constraints = f.validation.map((v) => {
        const cAttrs: Record<string, any> = { name: v.name };
        if (v.config !== undefined) cAttrs.config = v.config;
        return moddle.create('camunda:Constraint', cAttrs);
      });
      fieldAttrs.validation = moddle.create('camunda:Validation', {
        constraints,
      });
    }

    // Properties (camunda:Properties > camunda:Property)
    if (f.properties && Object.keys(f.properties).length > 0) {
      const props = Object.entries(f.properties).map(([id, value]) =>
        moddle.create('camunda:Property', { id, value })
      );
      fieldAttrs.properties = moddle.create('camunda:Properties', {
        values: props,
      });
    }

    return moddle.create('camunda:FormField', fieldAttrs);
  });

  // Build camunda:FormData
  const formDataAttrs: Record<string, any> = { fields: formFields };
  if (businessKey) formDataAttrs.businessKey = businessKey;
  const formData = moddle.create('camunda:FormData', formDataAttrs);

  upsertExtensionElement(moddle, bo, modeling, element, 'camunda:FormData', formData);

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    fieldCount: formFields.length,
    businessKey: businessKey || undefined,
    message: `Set form data with ${formFields.length} field(s) on ${elementId}`,
    nextSteps: [
      {
        tool: 'connect_bpmn_elements',
        description: 'Connect this task to the next element in the process flow.',
      },
      {
        tool: 'export_bpmn',
        description: 'Export the diagram once the process is complete.',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_form_data',
  description:
    'Create camunda:FormData with camunda:FormField children as extension elements on User Tasks and Start Events (Generated Task Forms). Supports field types: string, long, boolean, date, enum. Fields can have validation constraints, enum values, default values, and custom properties. ' +
    'Common patterns: required text field {id:"name", label:"Name", type:"string", validation:[{name:"required"}]}; ' +
    'enum dropdown {id:"priority", label:"Priority", type:"enum", defaultValue:"medium", values:[{id:"low",name:"Low"},{id:"medium",name:"Medium"},{id:"high",name:"High"}]}; ' +
    'date field {id:"dueDate", label:"Due Date", type:"date", datePattern:"dd/MM/yyyy"}; ' +
    'boolean checkbox {id:"approved", label:"Approved?", type:"boolean", defaultValue:"false"}.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to update (must be bpmn:UserTask or bpmn:StartEvent)',
      },
      businessKey: {
        type: 'string',
        description: 'Optional field ID to use as the business key for the process instance',
      },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Field ID (unique within the form)' },
            label: { type: 'string', description: 'Display label for the field' },
            type: {
              type: 'string',
              enum: ['string', 'long', 'boolean', 'date', 'enum'],
              description: 'Field type',
            },
            defaultValue: {
              type: 'string',
              description: 'Default value for the field',
            },
            datePattern: {
              type: 'string',
              description: "Date pattern for date fields (e.g. 'dd/MM/yyyy')",
            },
            properties: {
              type: 'object',
              description: 'Custom key-value properties on the field',
              additionalProperties: { type: 'string' },
            },
            validation: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description:
                      "Constraint name (e.g. 'required', 'minlength', 'maxlength', 'min', 'max', 'readonly', 'regex')",
                  },
                  config: {
                    type: 'string',
                    description: "Constraint config value (e.g. '5' for minlength)",
                  },
                },
                required: ['name'],
              },
              description: 'Validation constraints for the field',
            },
            values: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Enum value ID' },
                  name: { type: 'string', description: 'Enum value display name' },
                },
                required: ['id', 'name'],
              },
              description: "Enum values (required when type is 'enum')",
            },
          },
          required: ['id', 'label', 'type'],
        },
        description: 'Array of form field definitions',
      },
    },
    required: ['diagramId', 'elementId', 'fields'],
    examples: [
      {
        title: 'Approval form with mixed field types',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'UserTask_ReviewOrder',
          fields: [
            { id: 'approved', label: 'Approved?', type: 'boolean', defaultValue: 'false' },
            {
              id: 'priority',
              label: 'Priority',
              type: 'enum',
              defaultValue: 'medium',
              values: [
                { id: 'low', name: 'Low' },
                { id: 'medium', name: 'Medium' },
                { id: 'high', name: 'High' },
              ],
            },
            {
              id: 'comment',
              label: 'Comments',
              type: 'string',
              validation: [{ name: 'required' }],
            },
          ],
        },
      },
    ],
  },
} as const;
