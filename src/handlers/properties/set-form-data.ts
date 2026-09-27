/**
 * Handler for set_form_data tool.
 *
 * Creates `camunda:FormData` with `camunda:FormField` children as extension
 * elements on User Tasks and Start Events.  This produces "Generated Task
 * Forms" (as opposed to "Embedded or External Task Forms" via formKey).
 */
// @mutating

import { type ToolResult } from '../../types';
import { typeMismatchError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  upsertExtensionElement,
  validateArgs,
  getService,
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

/** Shared `{ businessKey, fields }` schema fragment (no diagramId/elementId). */
export const FORM_DATA_SCHEMA_PROPERTIES = {
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
} as const;

/** Throws unless `effectiveType` is a UserTask or StartEvent (camunda:FormData target types). */
export function assertFormDataTarget(effectiveType: string, elementId: string): void {
  if (effectiveType !== 'bpmn:UserTask' && effectiveType !== 'bpmn:StartEvent') {
    throw typeMismatchError(elementId, effectiveType, ['bpmn:UserTask', 'bpmn:StartEvent']);
  }
}

export interface SetFormDataCoreResult {
  fieldCount: number;
  businessKey?: string;
}

/**
 * Build and upsert the camunda:FormData extension element. Synchronous — no
 * XML sync or lint feedback — so it is safe to call from within a
 * command-stack `preExecute` (see `applyPropertyUpdateItem` in
 * `set-properties.ts`) alongside other elements' updates, grouped into one
 * undo step.
 */
export function applySetFormDataCore(
  diagram: ReturnType<typeof requireDiagram>,
  elementId: string,
  args: Pick<SetFormDataArgs, 'businessKey' | 'fields'>
): SetFormDataCoreResult {
  const { businessKey, fields } = args;
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  assertFormDataTarget(bo.$type, elementId);

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

  return { fieldCount: formFields.length, businessKey: businessKey || undefined };
}

export async function handleSetFormData(args: SetFormDataArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'fields']);
  const { diagramId, elementId } = args;
  const diagram = requireDiagram(diagramId);

  const { fieldCount, businessKey } = applySetFormDataCore(diagram, elementId, args);

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    fieldCount,
    businessKey,
    message: `Set form data with ${fieldCount} field(s) on ${elementId}`,
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
      ...FORM_DATA_SCHEMA_PROPERTIES,
    },
    required: ['diagramId', 'elementId', 'fields'],
  },
} as const;
