/**
 * Tests for add_bpmn_element with isForCompensation=true parameter.
 *
 * When creating a compensation handler task, the tool should:
 * 1. Set the isForCompensation property on the element
 * 2. Return a nextSteps sequence guiding the user through the mandatory
 *    compensation wiring order (layout BEFORE connecting via Association)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement } from '../../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('add_bpmn_element — isForCompensation parameter', () => {
  beforeEach(() => clearDiagrams());

  test('sets isForCompensation=true on the created element', async () => {
    const diagramId = await createDiagram('Compensation Handler');
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        name: 'Refund Payment',
        isForCompensation: true,
      } as any)
    );

    expect(result.success).toBe(true);
    const elementId = result.elementId as string;
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;
    const el = reg.get(elementId);
    expect(el.businessObject?.isForCompensation).toBe(true);
  });

  test('response includes nextSteps for compensation workflow when isForCompensation=true', async () => {
    const diagramId = await createDiagram('Compensation Handler');

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        name: 'Refund Payment',
        isForCompensation: true,
      } as any)
    );

    expect(result.nextSteps).toBeDefined();
    const steps = result.nextSteps as Array<{ tool: string; description: string }>;
    // Should recommend adding a BoundaryEvent with CompensateEventDefinition
    const hasBoundaryEventStep = steps.some(
      (s) =>
        s.description?.toLowerCase().includes('boundaryevent') ||
        s.description?.toLowerCase().includes('boundary event') ||
        s.description?.toLowerCase().includes('compensateeventdefinition')
    );
    expect(hasBoundaryEventStep).toBe(true);
    // Should recommend running layout_bpmn_diagram BEFORE connecting
    expect(steps.some((s) => s.tool === 'layout_bpmn_diagram')).toBe(true);
    // Should recommend using connect_bpmn_elements (for the Association)
    expect(steps.some((s) => s.tool === 'connect_bpmn_elements')).toBe(true);
  });

  test('layout_bpmn_diagram step appears before connect_bpmn_elements step', async () => {
    const diagramId = await createDiagram('Compensation Handler');

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        name: 'Refund Payment',
        isForCompensation: true,
      } as any)
    );

    const steps = result.nextSteps as Array<{ tool: string; description: string }>;
    const layoutIdx = steps.findIndex((s) => s.tool === 'layout_bpmn_diagram');
    const connectIdx = steps.findIndex((s) => s.tool === 'connect_bpmn_elements');
    expect(layoutIdx).toBeGreaterThanOrEqual(0);
    expect(connectIdx).toBeGreaterThanOrEqual(0);
    expect(layoutIdx).toBeLessThan(connectIdx);
  });

  test('does not add compensation nextSteps when isForCompensation is not set', async () => {
    const diagramId = await createDiagram('Normal Task');

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        name: 'Normal Task',
      })
    );

    // nextSteps should not have compensation-specific guidance
    const steps = (result.nextSteps as Array<any>) ?? [];
    const hasCompStep = steps.some(
      (s: any) =>
        typeof s.description === 'string' &&
        s.description.toLowerCase().includes('isforcompensation')
    );
    expect(hasCompStep).toBe(false);
  });

  test('isForCompensation works on ServiceTask elements', async () => {
    const diagramId = await createDiagram('Service Compensation');

    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Rollback Transaction',
        isForCompensation: true,
      } as any)
    );

    expect(result.success).toBe(true);
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;
    const el = reg.get(result.elementId as string);
    expect(el.businessObject?.isForCompensation).toBe(true);
  });
});
