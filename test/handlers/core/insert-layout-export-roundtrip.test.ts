/**
 * Integration tests for insert → layout → export roundtrip workflows.
 *
 * Verifies that the pipeline preserves DI integrity:
 * - No duplicate BPMNShape/BPMNEdge elements
 * - All process elements have corresponding DI entries
 * - Re-imported XML is lint-clean
 *
 * See TODO-timer.md §2: "Create automated tests for insert → layout → export
 * workflows to catch duplicates"
 */

import { describe, test, expect, afterEach } from 'vitest';
import {
  handleInsertElement,
  handleLayoutDiagram,
  handleImportXml,
  handleValidate,
  handleSetEventDefinition,
} from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams, exportXml } from '../../helpers';

afterEach(() => clearDiagrams());

/** Count BPMNShape elements and assert all IDs are unique. */
function assertNoDuplicateDiShapes(xml: string): void {
  const shapeMatches = xml.match(/bpmndi:BPMNShape\s+id="([^"]+)"/g) || [];
  const shapeIds = shapeMatches.map((m: string) => m.match(/id="([^"]+)"/)?.[1]);
  const uniqueIds = new Set(shapeIds);
  expect(shapeIds.length, 'Duplicate BPMNShape IDs found').toBe(uniqueIds.size);
}

/** Count BPMNEdge elements and assert all IDs are unique. */
function assertNoDuplicateDiEdges(xml: string): void {
  const edgeMatches = xml.match(/bpmndi:BPMNEdge\s+id="([^"]+)"/g) || [];
  const edgeIds = edgeMatches.map((m: string) => m.match(/id="([^"]+)"/)?.[1]);
  const uniqueIds = new Set(edgeIds);
  expect(edgeIds.length, 'Duplicate BPMNEdge IDs found').toBe(uniqueIds.size);
}

/** Assert that every bpmn element referenced in the process has a DI shape. */
function assertAllElementsHaveDiShapes(xml: string): void {
  // Extract element IDs from process definition (tasks, events, gateways)
  const elementPattern =
    /bpmn:(userTask|serviceTask|scriptTask|manualTask|businessRuleTask|sendTask|receiveTask|callActivity|subProcess|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent)\s+id="([^"]+)"/gi;
  const processElementIds = new Set<string>();
  let match;
  while ((match = elementPattern.exec(xml)) !== null) {
    processElementIds.add(match[2]);
  }

  // Extract bpmnElement references from BPMNShape entries
  const shapeElementPattern = /BPMNShape[^>]+bpmnElement="([^"]+)"/g;
  const shapedElementIds = new Set<string>();
  while ((match = shapeElementPattern.exec(xml)) !== null) {
    shapedElementIds.add(match[1]);
  }

  for (const id of processElementIds) {
    expect(shapedElementIds.has(id), `Element ${id} has no BPMNShape in DI`).toBe(true);
  }
}

describe('insert → layout → export roundtrip', () => {
  test('insert task into flow, layout, export — no duplicate DI', async () => {
    const diagramId = await createDiagram('roundtrip-insert');

    // Build: Start → Task → End
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
      afterElementId: start,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: task,
    });

    // Find the flow between Start and Task
    const xml1 = await exportXml(diagramId);
    const flowMatch = xml1.match(/sequenceFlow id="([^"]+)"[^>]*sourceRef="[^"]*Start[^"]*"/i);
    expect(flowMatch).toBeTruthy();

    // Find the flow between Review and Done
    const flowMatch2 = xml1.match(/sequenceFlow id="([^"]+)"[^>]*sourceRef="[^"]*Review[^"]*"/i);
    expect(flowMatch2).toBeTruthy();
    const flowId = flowMatch2![1];

    // Insert a ServiceTask between Review and Done
    const insertResult = parseResult(
      await handleInsertElement({
        diagramId,
        flowId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Order',
      })
    );
    expect(insertResult.success).toBe(true);

    // Run layout
    await handleLayoutDiagram({ diagramId });

    // Export and verify
    const xml = await exportXml(diagramId);
    assertNoDuplicateDiShapes(xml);
    assertNoDuplicateDiEdges(xml);
    assertAllElementsHaveDiShapes(xml);
    expect(xml).toContain('Process Order');
  });

  test('insert gateway into flow, layout, export — no duplicate DI', async () => {
    const diagramId = await createDiagram('roundtrip-gateway');

    // Build: Start → Task → End
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Enter Details',
      afterElementId: start,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: task,
    });

    // Find flow between Task and End
    const xml1 = await exportXml(diagramId);
    const flowMatch = xml1.match(
      /sequenceFlow id="([^"]+)"[^>]*sourceRef="[^"]*EnterDetails[^"]*"/i
    );
    expect(flowMatch).toBeTruthy();
    const flowId = flowMatch![1];

    // Insert an ExclusiveGateway
    const insertResult = parseResult(
      await handleInsertElement({
        diagramId,
        flowId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Valid?',
      })
    );
    expect(insertResult.success).toBe(true);

    // Run layout
    await handleLayoutDiagram({ diagramId });

    // Export and verify
    const xml = await exportXml(diagramId);
    assertNoDuplicateDiShapes(xml);
    assertNoDuplicateDiEdges(xml);
    assertAllElementsHaveDiShapes(xml);
  });

  test('insert timer event into flow, layout, export — no duplicate DI', async () => {
    const diagramId = await createDiagram('roundtrip-timer');

    // Build: Start → Task → End
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Configure',
      afterElementId: start,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: task,
    });

    // Find flow between Task and End
    const xml1 = await exportXml(diagramId);
    const flowMatch = xml1.match(/sequenceFlow id="([^"]+)"[^>]*sourceRef="[^"]*Configure[^"]*"/i);
    expect(flowMatch).toBeTruthy();
    const flowId = flowMatch![1];

    // Insert an IntermediateCatchEvent (timer)
    const insertResult = parseResult(
      await handleInsertElement({
        diagramId,
        flowId,
        elementType: 'bpmn:IntermediateCatchEvent',
        name: 'Wait for Date',
      })
    );
    expect(insertResult.success).toBe(true);

    // Add timer definition
    await handleSetEventDefinition({
      diagramId,
      elementId: insertResult.elementId,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      properties: { timeDuration: 'PT24H' },
    });

    // Run layout
    await handleLayoutDiagram({ diagramId });

    // Export and verify
    const xml = await exportXml(diagramId);
    assertNoDuplicateDiShapes(xml);
    assertNoDuplicateDiEdges(xml);
    assertAllElementsHaveDiShapes(xml);
    expect(xml).toContain('Wait for Date');
    expect(xml).toContain('PT24H');
  });

  test('multiple inserts → layout → export preserves DI integrity', async () => {
    const diagramId = await createDiagram('roundtrip-multi-insert');

    // Build: Start → Review → End
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const review = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
      afterElementId: start,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: review,
    });

    // Find flow between Start and Review
    let xml = await exportXml(diagramId);
    let flowMatch = xml.match(/sequenceFlow id="([^"]+)"[^>]*sourceRef="[^"]*Start[^"]*"/i);
    expect(flowMatch).toBeTruthy();

    // Insert a task before Review
    const insert1 = parseResult(
      await handleInsertElement({
        diagramId,
        flowId: flowMatch![1],
        elementType: 'bpmn:UserTask',
        name: 'Enter Data',
      })
    );
    expect(insert1.success).toBe(true);

    // Find flow between Review and Done
    xml = await exportXml(diagramId);
    flowMatch = xml.match(/sequenceFlow id="([^"]+)"[^>]*sourceRef="[^"]*Review[^"]*"/i);
    expect(flowMatch).toBeTruthy();

    // Insert another task after Review
    const insert2 = parseResult(
      await handleInsertElement({
        diagramId,
        flowId: flowMatch![1],
        elementType: 'bpmn:ServiceTask',
        name: 'Send Notification',
      })
    );
    expect(insert2.success).toBe(true);

    // Run layout
    await handleLayoutDiagram({ diagramId });

    // Export and verify — no duplicates after multiple inserts
    xml = await exportXml(diagramId);
    assertNoDuplicateDiShapes(xml);
    assertNoDuplicateDiEdges(xml);
    assertAllElementsHaveDiShapes(xml);
    expect(xml).toContain('Enter Data');
    expect(xml).toContain('Send Notification');
  });

  test('insert → layout → export → reimport has zero lint errors', async () => {
    const diagramId = await createDiagram('roundtrip-lint-clean');

    // Build: Start → UserTask → End
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Process Order',
      afterElementId: start,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: task,
    });

    // Find flow between Start and Task
    const xml1 = await exportXml(diagramId);
    const flowMatch = xml1.match(/sequenceFlow id="([^"]+)"[^>]*sourceRef="[^"]*Start[^"]*"/i);
    expect(flowMatch).toBeTruthy();

    // Insert a task
    const insertResult = parseResult(
      await handleInsertElement({
        diagramId,
        flowId: flowMatch![1],
        elementType: 'bpmn:UserTask',
        name: 'Validate Order',
      })
    );
    expect(insertResult.success).toBe(true);

    // Layout + export
    await handleLayoutDiagram({ diagramId });
    const xml = await exportXml(diagramId);

    // Re-import
    const importResult = parseResult(await handleImportXml({ xml }));
    expect(importResult.success).toBe(true);

    // Lint the re-imported diagram — only errors matter
    const lintResult = parseResult(await handleValidate({ diagramId: importResult.diagramId }));
    const errors = (lintResult.issues || []).filter((i: any) => i.severity === 'error');
    expect(errors).toEqual([]);
  });
});
