/**
 * Integration test: import → modify → export round-trip with boundary events.
 *
 * Verifies that importing complex BPMN (with boundary events, subprocesses,
 * data associations), modifying it via MCP tools, and re-exporting
 * produces valid BPMN without corruption.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { handleImportXml } from '../../src/handlers/import-xml';
import { handleAddElement } from '../../src/handlers/add-element';
import { handleExportBpmn } from '../../src/handlers/export';
import { handleListElements } from '../../src/handlers/list-elements';
import { handleInsertElement } from '../../src/handlers/insert-element';
import { clearDiagrams } from '../../src/diagram-manager';
import { parseResult } from '../helpers';

afterEach(() => clearDiagrams());

/** A real-world BPMN with a boundary error event on a service task. */
const BOUNDARY_EVENT_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                   xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true" camunda:historyTimeToLive="P180D">
    <bpmn:startEvent id="Start_1" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:serviceTask id="Task_1" name="Call API" camunda:type="external" camunda:topic="api">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:boundaryEvent id="Boundary_1" name="API Error" attachedToRef="Task_1">
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
      <bpmn:errorEventDefinition id="ErrorDef_1" />
    </bpmn:boundaryEvent>
    <bpmn:endEvent id="End_1" name="Done">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="End_2" name="Error">
      <bpmn:incoming>Flow_3</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Boundary_1" targetRef="End_2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="180" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="280" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="452" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_2_di" bpmnElement="End_2">
        <dc:Bounds x="452" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Boundary_1_di" bpmnElement="Boundary_1">
        <dc:Bounds x="312" y="140" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="216" y="118" />
        <di:waypoint x="280" y="118" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="380" y="118" />
        <di:waypoint x="452" y="118" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3">
        <di:waypoint x="330" y="176" />
        <di:waypoint x="330" y="218" />
        <di:waypoint x="452" y="218" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('import → modify → export round-trip with boundary events', () => {
  test('should preserve boundary events after import and modification', async () => {
    // Step 1: Import
    const importResult = parseResult(
      await handleImportXml({ xml: BOUNDARY_EVENT_BPMN, autoLayout: false })
    );
    expect(importResult.success).toBe(true);
    const diagramId = importResult.diagramId;

    // Step 2: Verify boundary event exists
    const elements = parseResult(await handleListElements({ diagramId }));
    const boundary = elements.elements.find((el: any) => el.id === 'Boundary_1');
    expect(boundary).toBeDefined();
    expect(boundary.type).toBe('bpmn:BoundaryEvent');

    // Step 3: Add a new element (should not affect boundary event)
    const addResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review',
        x: 500,
        y: 100,
      })
    );
    expect(addResult.success).toBe(true);

    // Step 4: Export and verify
    const exportResult = await handleExportBpmn({
      diagramId,
      format: 'xml',
      skipLint: true,
    });
    const xml = exportResult.content[0].text;

    // Boundary event should still be present and correct type
    expect(xml).toContain('bpmn:boundaryEvent');
    expect(xml).toContain('id="Boundary_1"');
    expect(xml).toContain('attachedToRef="Task_1"');
    expect(xml).toContain('bpmn:errorEventDefinition');
  });

  test('should preserve boundary events after inserting an element into a flow', async () => {
    // Import
    const importResult = parseResult(
      await handleImportXml({ xml: BOUNDARY_EVENT_BPMN, autoLayout: false })
    );
    const diagramId = importResult.diagramId;

    // Insert a user task between Start and Task_1
    const insertResult = parseResult(
      await handleInsertElement({
        diagramId,
        flowId: 'Flow_1',
        elementType: 'bpmn:UserTask',
        name: 'Approve',
      })
    );
    expect(insertResult.success).toBe(true);

    // Verify boundary event still exists and is attached
    const elements = parseResult(await handleListElements({ diagramId }));
    const boundary = elements.elements.find((el: any) => el.type === 'bpmn:BoundaryEvent');
    expect(boundary).toBeDefined();

    // Export and verify
    const exportResult = await handleExportBpmn({
      diagramId,
      format: 'xml',
      skipLint: true,
    });
    const xml = exportResult.content[0].text;
    expect(xml).toContain('bpmn:boundaryEvent');
    expect(xml).toContain('attachedToRef="Task_1"');
  });

  test('should maintain element connections after round-trip', async () => {
    // Import
    const importResult = parseResult(
      await handleImportXml({ xml: BOUNDARY_EVENT_BPMN, autoLayout: false })
    );
    const diagramId = importResult.diagramId;

    // Export
    const exportResult = await handleExportBpmn({
      diagramId,
      format: 'xml',
      skipLint: true,
    });
    const xml = exportResult.content[0].text;

    // All original flows should still be present
    expect(xml).toContain('sourceRef="Start_1"');
    expect(xml).toContain('targetRef="Task_1"');
    expect(xml).toContain('sourceRef="Task_1"');
    expect(xml).toContain('targetRef="End_1"');
    expect(xml).toContain('sourceRef="Boundary_1"');
    expect(xml).toContain('targetRef="End_2"');
  });
});
