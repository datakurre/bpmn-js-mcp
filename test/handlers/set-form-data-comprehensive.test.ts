/**
 * Comprehensive tests for set_bpmn_form_data.
 *
 * Covers validation constraints, enum fields, custom properties,
 * businessKey, and date patterns.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetFormData, handleGetProperties } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

/** Extract camunda:FormData from the extensionElements array returned by get_properties. */
function getFormData(props: any): any {
  return props.extensionElements?.find((e: any) => e.type === 'camunda:FormData');
}

describe('set_bpmn_form_data — comprehensive', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates form fields with validation constraints', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: taskId,
        fields: [
          {
            id: 'email',
            label: 'Email Address',
            type: 'string',
            validation: [
              { name: 'required' },
              { name: 'minlength', config: '5' },
              { name: 'maxlength', config: '100' },
              { name: 'regex', config: '^[^@]+@[^@]+\\.[^@]+$' },
            ],
          },
        ],
      })
    );
    expect(res.success).toBe(true);

    // Verify via get_properties
    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const formData = getFormData(props);
    expect(formData).toBeDefined();
    expect(formData.fields).toHaveLength(1);
    expect(formData.fields[0].id).toBe('email');
    const constraints = formData.fields[0].validation;
    expect(constraints).toHaveLength(4);
  });

  test('creates enum field type with values', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Select' });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: taskId,
        fields: [
          {
            id: 'priority',
            label: 'Priority Level',
            type: 'enum',
            defaultValue: 'medium',
            values: [
              { id: 'low', name: 'Low Priority' },
              { id: 'medium', name: 'Medium Priority' },
              { id: 'high', name: 'High Priority' },
            ],
          },
        ],
      })
    );
    expect(res.success).toBe(true);

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const formData = getFormData(props);
    expect(formData.fields[0].type).toBe('enum');
    expect(formData.fields[0].values).toHaveLength(3);
  });

  test('supports businessKey parameter', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start Form' });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: startId,
        businessKey: 'orderId',
        fields: [
          { id: 'orderId', label: 'Order ID', type: 'string' },
          { id: 'amount', label: 'Amount', type: 'long' },
        ],
      })
    );
    expect(res.success).toBe(true);
  });

  test('supports custom field properties', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Custom Props' });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: taskId,
        fields: [
          {
            id: 'field1',
            label: 'Field 1',
            type: 'string',
            properties: {
              customProp: 'customValue',
              anotherProp: '42',
            },
          },
        ],
      })
    );
    expect(res.success).toBe(true);
  });

  test('supports date field type with pattern', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Date Task' });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: taskId,
        fields: [
          {
            id: 'dueDate',
            label: 'Due Date',
            type: 'date',
            datePattern: 'dd/MM/yyyy',
          },
        ],
      })
    );
    expect(res.success).toBe(true);
  });

  test('supports boolean field type', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Bool Task' });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: taskId,
        fields: [
          {
            id: 'approved',
            label: 'Approved?',
            type: 'boolean',
            defaultValue: 'false',
          },
        ],
      })
    );
    expect(res.success).toBe(true);

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const formData = getFormData(props);
    const field = formData?.fields?.[0];
    expect(field?.type).toBe('boolean');
    expect(field?.defaultValue).toBe('false');
  });

  test('supports multiple fields at once', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Multi' });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: taskId,
        fields: [
          { id: 'name', label: 'Name', type: 'string', validation: [{ name: 'required' }] },
          { id: 'age', label: 'Age', type: 'long', validation: [{ name: 'min', config: '0' }] },
          { id: 'active', label: 'Active', type: 'boolean' },
          { id: 'birthday', label: 'Birthday', type: 'date', datePattern: 'yyyy-MM-dd' },
          {
            id: 'role',
            label: 'Role',
            type: 'enum',
            values: [
              { id: 'admin', name: 'Admin' },
              { id: 'user', name: 'User' },
            ],
          },
        ],
      })
    );
    expect(res.success).toBe(true);

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const formData = getFormData(props);
    expect(formData?.fields).toHaveLength(5);
  });
});
