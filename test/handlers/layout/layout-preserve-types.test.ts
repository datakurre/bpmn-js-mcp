/**
 * Regression test: layout_bpmn_diagram must preserve element types.
 *
 * Ensures that after a full ELK layout pass, every element's $type
 * matches its pre-layout type.  Particularly important for boundary events
 * which can lose their type in headless mode.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { handleImportXml } from '../../../src/handlers/core/import-xml';
import { handleLayoutDiagram } from '../../../src/handlers/layout/layout-diagram';
import { handleListElements } from '../../../src/handlers/elements/list-elements';
import { clearDiagrams } from '../../../src/diagram-manager';
import { parseResult } from '../../helpers';

afterEach(() => clearDiagrams());

/** BPMN with multiple element types including boundary event. */
const MIXED_TYPES_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                   xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true" camunda:historyTimeToLive="P180D">
    <bpmn:startEvent id="Start_1" name="Begin">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="UserTask_1" name="Review">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:serviceTask id="ServiceTask_1" name="Process" camunda:type="external" camunda:topic="work">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:exclusiveGateway id="Gateway_1" name="OK?">
      <bpmn:incoming>Flow_3</bpmn:incoming>
      <bpmn:outgoing>Flow_4</bpmn:outgoing>
      <bpmn:outgoing>Flow_5</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:endEvent id="End_1" name="Done">
      <bpmn:incoming>Flow_4</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="End_2" name="Failed">
      <bpmn:incoming>Flow_5</bpmn:incoming>
      <bpmn:incoming>Flow_6</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:boundaryEvent id="Boundary_Timer" name="Timeout" attachedToRef="UserTask_1">
      <bpmn:outgoing>Flow_6</bpmn:outgoing>
      <bpmn:timerEventDefinition id="TimerDef_1">
        <bpmn:timeDuration>PT1H</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="UserTask_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="UserTask_1" targetRef="ServiceTask_1" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="ServiceTask_1" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Gateway_1" targetRef="End_1" />
    <bpmn:sequenceFlow id="Flow_5" sourceRef="Gateway_1" targetRef="End_2" />
    <bpmn:sequenceFlow id="Flow_6" sourceRef="Boundary_Timer" targetRef="End_2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="180" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="UserTask_1_di" bpmnElement="UserTask_1">
        <dc:Bounds x="270" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="ServiceTask_1_di" bpmnElement="ServiceTask_1">
        <dc:Bounds x="430" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_1_di" bpmnElement="Gateway_1" isMarkerVisible="true">
        <dc:Bounds x="585" y="93" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="692" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_2_di" bpmnElement="End_2">
        <dc:Bounds x="692" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Boundary_Timer_di" bpmnElement="Boundary_Timer">
        <dc:Bounds x="302" y="140" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="216" y="118" />
        <di:waypoint x="270" y="118" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="370" y="118" />
        <di:waypoint x="430" y="118" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3">
        <di:waypoint x="530" y="118" />
        <di:waypoint x="585" y="118" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_4_di" bpmnElement="Flow_4">
        <di:waypoint x="635" y="118" />
        <di:waypoint x="692" y="118" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_5_di" bpmnElement="Flow_5">
        <di:waypoint x="610" y="143" />
        <di:waypoint x="610" y="218" />
        <di:waypoint x="692" y="218" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_6_di" bpmnElement="Flow_6">
        <di:waypoint x="320" y="176" />
        <di:waypoint x="320" y="218" />
        <di:waypoint x="692" y="218" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('layout_bpmn_diagram — preserves element types', () => {
  test('should preserve all element types after full layout', async () => {
    // Import diagram
    const importResult = parseResult(
      await handleImportXml({ xml: MIXED_TYPES_BPMN, autoLayout: false })
    );
    const diagramId = importResult.diagramId;

    // Record pre-layout types
    const beforeElements = parseResult(await handleListElements({ diagramId }));
    const preTypes = new Map<string, string>();
    for (const el of beforeElements.elements) {
      preTypes.set(el.id, el.type);
    }

    // Run full layout
    await handleLayoutDiagram({ diagramId });

    // Record post-layout types
    const afterElements = parseResult(await handleListElements({ diagramId }));
    const postTypes = new Map<string, string>();
    for (const el of afterElements.elements) {
      postTypes.set(el.id, el.type);
    }

    // Every pre-layout element should have the same type after layout
    for (const [id, preType] of preTypes) {
      const postType = postTypes.get(id);
      // Element may have been internally recreated but the type should match
      if (postType) {
        expect(postType).toBe(preType);
      }
    }
  });

  test('should preserve boundary event type specifically', async () => {
    const importResult = parseResult(
      await handleImportXml({ xml: MIXED_TYPES_BPMN, autoLayout: false })
    );
    const diagramId = importResult.diagramId;

    // Verify boundary event before layout
    const before = parseResult(await handleListElements({ diagramId }));
    const boundaryBefore = before.elements.find((el: any) => el.id === 'Boundary_Timer');
    expect(boundaryBefore).toBeDefined();
    expect(boundaryBefore.type).toBe('bpmn:BoundaryEvent');

    // Layout
    await handleLayoutDiagram({ diagramId });

    // Verify boundary event after layout
    const after = parseResult(await handleListElements({ diagramId }));
    const boundaryAfter = after.elements.find((el: any) => el.id === 'Boundary_Timer');
    expect(boundaryAfter).toBeDefined();
    expect(boundaryAfter.type).toBe('bpmn:BoundaryEvent');
  });

  test('should keep boundary events near their host after layout', async () => {
    const importResult = parseResult(
      await handleImportXml({ xml: MIXED_TYPES_BPMN, autoLayout: false })
    );
    const diagramId = importResult.diagramId;

    // Layout
    await handleLayoutDiagram({ diagramId });

    // Get element positions
    const elements = parseResult(await handleListElements({ diagramId }));
    const boundary = elements.elements.find((el: any) => el.id === 'Boundary_Timer');
    const host = elements.elements.find((el: any) => el.id === 'UserTask_1');

    expect(boundary).toBeDefined();
    expect(host).toBeDefined();

    // Boundary event center should be within host bounds + small margin
    const beCx = boundary.x + (boundary.width || 36) / 2;
    const beCy = boundary.y + (boundary.height || 36) / 2;
    const hostRight = host.x + (host.width || 100);
    const hostBottom = host.y + (host.height || 80);
    const margin = 20;

    expect(beCx).toBeGreaterThanOrEqual(host.x - margin);
    expect(beCx).toBeLessThanOrEqual(hostRight + margin);
    expect(beCy).toBeGreaterThanOrEqual(host.y - margin);
    expect(beCy).toBeLessThanOrEqual(hostBottom + margin);
  });
});
