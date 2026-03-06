import { describe, test, expect, beforeEach } from 'vitest';
import { handleValidate as handleLintDiagram } from '../../../src/handlers';
import { handleImportXml } from '../../../src/handlers/core/import-xml';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';

describe('bpmnlint layout-needs-alignment rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  const LINT_CONFIG = {
    rules: {
      'bpmn-mcp/layout-needs-alignment': 'warn',
    },
  };

  test('does not warn for a small diagram (below minimum element count)', async () => {
    const diagramId = await createDiagram('Small');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Do Work',
      afterElementId: start,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      afterElementId: task,
    });

    const res = parseResult(await handleLintDiagram({ diagramId, config: LINT_CONFIG }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/layout-needs-alignment');
    expect(issues).toHaveLength(0);
  });

  test('does not warn for a well-laid-out diagram', async () => {
    const diagramId = await createDiagram('Clean');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Step 1',
      afterElementId: start,
    });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Check?',
      afterElementId: t1,
    });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Step 2',
      afterElementId: gw,
    });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Step 3',
      afterElementId: gw,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: t2,
    });
    await connect(diagramId, t3, end);

    const res = parseResult(await handleLintDiagram({ diagramId, config: LINT_CONFIG }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/layout-needs-alignment');
    expect(issues).toHaveLength(0);
  });

  test('warns for a diagram with diagonal flows and overlapping shapes', async () => {
    // Build a BPMN XML with intentionally bad DI: diagonal waypoints, overlapping shapes
    const messyBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start" />
    <bpmn:task id="Task_1" name="Task A" />
    <bpmn:task id="Task_2" name="Task B" />
    <bpmn:task id="Task_3" name="Task C" />
    <bpmn:task id="Task_4" name="Task D" />
    <bpmn:endEvent id="End_1" name="End" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="Task_2" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_2" targetRef="Task_3" />
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_3" targetRef="Task_4" />
    <bpmn:sequenceFlow id="Flow_5" sourceRef="Task_4" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="200" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="210" y="205" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_3_di" bpmnElement="Task_3">
        <dc:Bounds x="400" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_4_di" bpmnElement="Task_4">
        <dc:Bounds x="403" y="103" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="600" y="300" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" />
        <di:waypoint x="200" y="240" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="300" y="240" />
        <di:waypoint x="400" y="140" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3">
        <di:waypoint x="310" y="245" />
        <di:waypoint x="400" y="140" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_4_di" bpmnElement="Flow_4">
        <di:waypoint x="500" y="140" />
        <di:waypoint x="600" y="318" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_5_di" bpmnElement="Flow_5">
        <di:waypoint x="503" y="143" />
        <di:waypoint x="600" y="318" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(
      await handleImportXml({ xml: messyBpmn, autoLayout: false, hintLevel: 'none' })
    );
    const diagramId = importRes.diagramId;
    expect(diagramId).toBeTruthy();

    const res = parseResult(await handleLintDiagram({ diagramId, config: LINT_CONFIG }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/layout-needs-alignment');

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('layout');
    // Should mention at least one of the heuristics
    expect(issues[0].message).toMatch(/non-orthogonal|overlapping|crossing|close/i);
  });

  test('warns for a diagram with many crossing flows', async () => {
    // Create a diagram with flows that cross each other
    const crossingBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start" />
    <bpmn:task id="Task_A" name="Task A" />
    <bpmn:task id="Task_B" name="Task B" />
    <bpmn:task id="Task_C" name="Task C" />
    <bpmn:task id="Task_D" name="Task D" />
    <bpmn:endEvent id="End_1" name="End" />
    <bpmn:sequenceFlow id="Flow_AC" sourceRef="Task_A" targetRef="Task_C" />
    <bpmn:sequenceFlow id="Flow_BD" sourceRef="Task_B" targetRef="Task_D" />
    <bpmn:sequenceFlow id="Flow_AD" sourceRef="Task_A" targetRef="Task_D" />
    <bpmn:sequenceFlow id="Flow_BC" sourceRef="Task_B" targetRef="Task_C" />
    <bpmn:sequenceFlow id="Flow_S" sourceRef="Start_1" targetRef="Task_A" />
    <bpmn:sequenceFlow id="Flow_E" sourceRef="Task_D" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_A_di" bpmnElement="Task_A">
        <dc:Bounds x="200" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_B_di" bpmnElement="Task_B">
        <dc:Bounds x="200" y="300" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_C_di" bpmnElement="Task_C">
        <dc:Bounds x="500" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_D_di" bpmnElement="Task_D">
        <dc:Bounds x="500" y="300" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="700" y="322" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_AC_di" bpmnElement="Flow_AC">
        <di:waypoint x="300" y="140" />
        <di:waypoint x="500" y="140" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_BD_di" bpmnElement="Flow_BD">
        <di:waypoint x="300" y="340" />
        <di:waypoint x="500" y="340" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_AD_di" bpmnElement="Flow_AD">
        <di:waypoint x="300" y="140" />
        <di:waypoint x="500" y="340" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_BC_di" bpmnElement="Flow_BC">
        <di:waypoint x="300" y="340" />
        <di:waypoint x="500" y="140" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_S_di" bpmnElement="Flow_S">
        <di:waypoint x="136" y="218" />
        <di:waypoint x="200" y="140" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_E_di" bpmnElement="Flow_E">
        <di:waypoint x="600" y="340" />
        <di:waypoint x="700" y="340" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(
      await handleImportXml({ xml: crossingBpmn, autoLayout: false, hintLevel: 'none' })
    );
    const diagramId = importRes.diagramId;

    const res = parseResult(await handleLintDiagram({ diagramId, config: LINT_CONFIG }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/layout-needs-alignment');

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('layout_bpmn_diagram');
  });

  test('fix suggestion is available', async () => {
    // Just check that the fix suggestion is properly configured
    const { suggestFix } = await import('../../../src/lint-suggestions');
    const suggestion = suggestFix(
      {
        rule: 'bpmn-mcp/layout-needs-alignment',
        elementId: 'Process_1',
        message: 'test',
        severity: 'warning',
      },
      'diagram_1'
    );
    expect(suggestion).toBeDefined();
    expect(suggestion).toContain('layout_bpmn_diagram');
  });

  test('warns when a bpmn:Association has waypoints far from its source or target element', async () => {
    // Compensation pattern where the association has stale/displaced waypoints:
    // the boundary event is at (250, 200) but the association first waypoint is at (50, 50) — far off
    const staleAssocBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_Host" name="Place Order" />
    <bpmn:task id="Task_Handler" name="Cancel Order" isForCompensation="true" />
    <bpmn:endEvent id="End_1" />
    <bpmn:boundaryEvent id="BE_Comp" attachedToRef="Task_Host">
      <bpmn:compensateEventDefinition id="CompDef_1" />
    </bpmn:boundaryEvent>
    <bpmn:association id="Assoc_1" sourceRef="BE_Comp" targetRef="Task_Handler" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_Host" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Host" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="152" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Host_di" bpmnElement="Task_Host">
        <dc:Bounds x="250" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Handler_di" bpmnElement="Task_Handler">
        <dc:Bounds x="450" y="400" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="602" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BE_Comp_di" bpmnElement="BE_Comp">
        <dc:Bounds x="282" y="240" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Assoc_1_di" bpmnElement="Assoc_1">
        <!-- Stale waypoints: far from BE_Comp (282,240) and Task_Handler (450,400) -->
        <di:waypoint x="50" y="50" />
        <di:waypoint x="50" y="51" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="188" y="218" />
        <di:waypoint x="250" y="218" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="350" y="218" />
        <di:waypoint x="602" y="218" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(
      await handleImportXml({ xml: staleAssocBpmn, autoLayout: false, hintLevel: 'none' })
    );
    const diagramId = importRes.diagramId as string;
    expect(diagramId).toBeTruthy();

    const res = parseResult(await handleLintDiagram({ diagramId, config: LINT_CONFIG }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/layout-needs-alignment');

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toMatch(/association|stale/i);
  });

  test('does not warn when association waypoints are close to their elements', async () => {
    // Same structure but association waypoints are correctly placed near the elements
    const goodAssocBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_Host" name="Place Order" />
    <bpmn:task id="Task_Handler" name="Cancel Order" isForCompensation="true" />
    <bpmn:endEvent id="End_1" />
    <bpmn:boundaryEvent id="BE_Comp" attachedToRef="Task_Host">
      <bpmn:compensateEventDefinition id="CompDef_1" />
    </bpmn:boundaryEvent>
    <bpmn:association id="Assoc_1" sourceRef="BE_Comp" targetRef="Task_Handler" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_Host" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Host" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="152" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Host_di" bpmnElement="Task_Host">
        <dc:Bounds x="250" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Handler_di" bpmnElement="Task_Handler">
        <dc:Bounds x="450" y="400" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="602" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BE_Comp_di" bpmnElement="BE_Comp">
        <dc:Bounds x="282" y="240" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Assoc_1_di" bpmnElement="Assoc_1">
        <!-- Correct waypoints: near BE_Comp center (300,258) and Task_Handler left edge (450,440) -->
        <di:waypoint x="300" y="276" />
        <di:waypoint x="450" y="440" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="188" y="218" />
        <di:waypoint x="250" y="218" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="350" y="218" />
        <di:waypoint x="602" y="218" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(
      await handleImportXml({ xml: goodAssocBpmn, autoLayout: false, hintLevel: 'none' })
    );
    const diagramId = importRes.diagramId as string;

    const res = parseResult(await handleLintDiagram({ diagramId, config: LINT_CONFIG }));
    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/layout-needs-alignment');

    expect(issues).toHaveLength(0);
  });
});
