import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetFormData, handleExportBpmn, handleGetProperties } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('set_bpmn_form_data', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates form data on a user task with basic fields', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Fill Form',
    });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: taskId,
        fields: [
          { id: 'name', label: 'Full Name', type: 'string', defaultValue: 'John' },
          { id: 'age', label: 'Age', type: 'long' },
          { id: 'active', label: 'Is Active', type: 'boolean', defaultValue: 'true' },
        ],
      })
    );
    expect(res.success).toBe(true);
    expect(res.fieldCount).toBe(3);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:formData');
    expect(xml).toContain('camunda:formField');
    expect(xml).toContain('id="name"');
    expect(xml).toContain('label="Full Name"');
    expect(xml).toContain('defaultValue="John"');
  });

  test('supports enum fields with values', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Select',
    });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: taskId,
        fields: [
          {
            id: 'priority',
            label: 'Priority',
            type: 'enum',
            values: [
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
            ],
          },
        ],
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:value');
  });

  test('supports validation constraints', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Validated',
    });

    await handleSetFormData({
      diagramId,
      elementId: taskId,
      fields: [
        {
          id: 'email',
          label: 'Email',
          type: 'string',
          validation: [{ name: 'required' }, { name: 'minlength', config: '5' }],
        },
      ],
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:validation');
    expect(xml).toContain('camunda:constraint');
    expect(xml).toContain('required');
    expect(xml).toContain('minlength');
  });

  test('supports businessKey', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
    });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: startId,
        businessKey: 'orderId',
        fields: [{ id: 'orderId', label: 'Order ID', type: 'string' }],
      })
    );
    expect(res.success).toBe(true);
    expect(res.businessKey).toBe('orderId');

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:formData');
  });

  test('throws for non-UserTask/StartEvent elements', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Service',
    });

    await expect(
      handleSetFormData({
        diagramId,
        elementId: taskId,
        fields: [{ id: 'f1', label: 'F1', type: 'string' }],
      })
    ).rejects.toThrow(/only supported on/);
  });

  test('is visible via get_element_properties', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Props Test',
    });

    await handleSetFormData({
      diagramId,
      elementId: taskId,
      fields: [{ id: 'f1', label: 'Field 1', type: 'string', defaultValue: 'abc' }],
    });

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    expect(props.extensionElements).toBeDefined();
    const fd = props.extensionElements.find((e: any) => e.type === 'camunda:FormData');
    expect(fd).toBeDefined();
    expect(fd.fields.length).toBe(1);
    expect(fd.fields[0].id).toBe('f1');
  });
});
