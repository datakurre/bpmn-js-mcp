/**
 * Tests for the `bpmn-mcp/compensation-missing-association` lint rule enhancement:
 * DI waypoint validation for compensation associations.
 *
 * TODO reference:
 *   "Enhance `compensation-missing-association`: when a semantic association exists
 *   between a compensation boundary event and a handler, also verify the
 *   corresponding `BPMNEdge` has at least two waypoints and that they are within
 *   element bounds; report a warning if not so the user knows the link is invisible
 *   even though it is semantically valid"
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleValidate } from '../../../src/handlers/core/validate';
import { handleImportXml } from '../../../src/handlers';
import { parseResult, clearDiagrams } from '../../helpers';

describe('bpmn-mcp/compensation-missing-association: DI waypoint check', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  const STALE_WAYPOINTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" />
    <bpmn:task id="Task_Host" name="Host Task" />
    <bpmn:task id="Task_Handler" name="Refund Payment" isForCompensation="true" />
    <bpmn:boundaryEvent id="BoundaryEvent_Comp" attachedToRef="Task_Host" cancelActivity="false">
      <bpmn:compensateEventDefinition id="CompDef_1" />
    </bpmn:boundaryEvent>
    <!-- Semantic association exists — compensation IS wired correctly -->
    <bpmn:association id="Assoc_Comp" sourceRef="BoundaryEvent_Comp" targetRef="Task_Handler" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_Host" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="152" y="222" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Host_di" bpmnElement="Task_Host">
        <dc:Bounds x="260" y="200" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Handler_di" bpmnElement="Task_Handler">
        <dc:Bounds x="130" y="340" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BoundaryEvent_Comp_di" bpmnElement="BoundaryEvent_Comp">
        <dc:Bounds x="433" y="222" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="188" y="240" />
        <di:waypoint x="260" y="240" />
      </bpmndi:BPMNEdge>
      <!-- Stale association edge: first waypoint (100,82) is far from source BoundaryEvent_Comp (433,222) -->
      <bpmndi:BPMNEdge id="Assoc_Comp_di" bpmnElement="Assoc_Comp">
        <di:waypoint x="100" y="82" />
        <di:waypoint x="100" y="60" />
        <di:waypoint x="180" y="60" />
        <di:waypoint x="180" y="340" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  const GOOD_WAYPOINTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_2" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_2" isExecutable="true">
    <bpmn:startEvent id="StartEvent_2" />
    <bpmn:task id="Task_Host2" name="Host Task" />
    <bpmn:task id="Task_Handler2" name="Refund Payment" isForCompensation="true" />
    <bpmn:boundaryEvent id="BoundaryEvent_Comp2" attachedToRef="Task_Host2" cancelActivity="false">
      <bpmn:compensateEventDefinition id="CompDef_2" />
    </bpmn:boundaryEvent>
    <bpmn:association id="Assoc_Good" sourceRef="BoundaryEvent_Comp2" targetRef="Task_Handler2" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="StartEvent_2" targetRef="Task_Host2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_2">
    <bpmndi:BPMNPlane id="BPMNPlane_2" bpmnElement="Process_2">
      <bpmndi:BPMNShape id="StartEvent_2_di" bpmnElement="StartEvent_2">
        <dc:Bounds x="152" y="222" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Host2_di" bpmnElement="Task_Host2">
        <dc:Bounds x="260" y="200" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Handler2_di" bpmnElement="Task_Handler2">
        <dc:Bounds x="130" y="340" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BoundaryEvent_Comp2_di" bpmnElement="BoundaryEvent_Comp2">
        <dc:Bounds x="292" y="262" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="188" y="240" />
        <di:waypoint x="260" y="240" />
      </bpmndi:BPMNEdge>
      <!-- Good waypoints: first point is near BoundaryEvent_Comp2, last is near Task_Handler2 -->
      <bpmndi:BPMNEdge id="Assoc_Good_di" bpmnElement="Assoc_Good">
        <di:waypoint x="310" y="298" />
        <di:waypoint x="180" y="340" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  test('warns when compensation association BPMNEdge waypoints are far outside source/target bounds', async () => {
    const importRes = parseResult(
      await handleImportXml({ xml: STALE_WAYPOINTS_XML, autoLayout: false })
    );
    const diagramId = importRes.diagramId;
    expect(diagramId).toBeDefined();

    const res = parseResult(
      await handleValidate({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: {
            'bpmn-mcp/compensation-missing-association': 'warn',
            'bpmn-mcp/disconnected-association-di': 'off',
          },
        },
      })
    );

    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/compensation-missing-association'
    );

    // Should warn even though the semantic association exists
    expect(issues.length).toBeGreaterThan(0);
    // The message should mention visibility or DI or waypoints
    const msg: string = issues[0].message ?? '';
    expect(msg.toLowerCase()).toMatch(/visible|waypoint|di|invisible|disconnected/);
  });

  test('no DI warning when compensation association BPMNEdge waypoints are within bounds', async () => {
    const importRes = parseResult(
      await handleImportXml({ xml: GOOD_WAYPOINTS_XML, autoLayout: false })
    );
    const diagramId = importRes.diagramId;
    expect(diagramId).toBeDefined();

    const res = parseResult(
      await handleValidate({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: {
            'bpmn-mcp/compensation-missing-association': 'warn',
            'bpmn-mcp/disconnected-association-di': 'off',
          },
        },
      })
    );

    const issues = res.issues.filter(
      (i: any) =>
        i.rule === 'bpmn-mcp/compensation-missing-association' &&
        (i.message?.toLowerCase().includes('visible') ||
          i.message?.toLowerCase().includes('waypoint') ||
          i.message?.toLowerCase().includes('di') ||
          i.message?.toLowerCase().includes('invisible'))
    );

    expect(issues).toHaveLength(0);
  });
});
