import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleValidate as handleLintDiagram,
  handleCreateCollaboration,
  handleImportXml,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('detect-single-organization-collaboration rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('flags collaboration when all pools share candidateGroups namespace', async () => {
    // Use XML import to ensure both pools have proper processRef
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Support" name="Support" processRef="Process_Support" />
    <bpmn:participant id="P_Billing" name="Billing" processRef="Process_Billing" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Support" isExecutable="true">
    <bpmn:userTask id="Task_HandleTicket" name="Handle Ticket" camunda:candidateGroups="org.acme.support" />
  </bpmn:process>
  <bpmn:process id="Process_Billing" isExecutable="true">
    <bpmn:userTask id="Task_ProcessInvoice" name="Process Invoice" camunda:candidateGroups="org.acme.billing" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Support_di" bpmnElement="P_Support" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_HandleTicket_di" bpmnElement="Task_HandleTicket">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_Billing_di" bpmnElement="P_Billing" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ProcessInvoice_di" bpmnElement="Task_ProcessInvoice">
        <dc:Bounds x="200" y="380" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(await handleImportXml({ xml }));
    const diagramId = importRes.diagramId;

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/detect-single-organization-collaboration': 'warn' },
        },
      })
    );

    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/detect-single-organization-collaboration'
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('same organization');
  });

  test('flags when all pools define candidateGroups (same org indicator)', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Frontend" name="Frontend Team" processRef="Process_Frontend" />
    <bpmn:participant id="P_Backend" name="Backend Team" processRef="Process_Backend" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Frontend" isExecutable="true">
    <bpmn:userTask id="Task_DesignUI" name="Design UI" camunda:candidateGroups="frontend" />
  </bpmn:process>
  <bpmn:process id="Process_Backend" isExecutable="true">
    <bpmn:userTask id="Task_BuildAPI" name="Build API" camunda:candidateGroups="backend" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Frontend_di" bpmnElement="P_Frontend" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_DesignUI_di" bpmnElement="Task_DesignUI">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_Backend_di" bpmnElement="P_Backend" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_BuildAPI_di" bpmnElement="Task_BuildAPI">
        <dc:Bounds x="200" y="380" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(await handleImportXml({ xml }));
    const diagramId = importRes.diagramId;

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/detect-single-organization-collaboration': 'warn' },
        },
      })
    );

    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/detect-single-organization-collaboration'
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  test('does not fire when only one pool has candidateGroups', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Internal" name="Internal" processRef="Process_Internal" />
    <bpmn:participant id="P_External" name="External API" processRef="Process_External" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Internal" isExecutable="true">
    <bpmn:userTask id="Task_Review" name="Review" camunda:candidateGroups="reviewers" />
  </bpmn:process>
  <bpmn:process id="Process_External" isExecutable="false">
    <bpmn:serviceTask id="Task_Call" name="Call API" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Internal_di" bpmnElement="P_Internal" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Review_di" bpmnElement="Task_Review">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_External_di" bpmnElement="P_External" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Call_di" bpmnElement="Task_Call">
        <dc:Bounds x="200" y="380" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(await handleImportXml({ xml }));
    const diagramId = importRes.diagramId;

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/detect-single-organization-collaboration': 'warn' },
        },
      })
    );

    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/detect-single-organization-collaboration'
    );
    expect(issues.length).toBe(0);
  });

  test('does not fire when pool is collapsed', async () => {
    const diagramId = await createDiagram('Collapsed Pool');

    parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Main Process' }, { name: 'External Service', collapsed: true }],
      })
    );

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/detect-single-organization-collaboration': 'warn' },
        },
      })
    );

    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/detect-single-organization-collaboration'
    );
    expect(issues.length).toBe(0);
  });
});

describe('message-flow-crossing-excessive rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when message flow crosses many sequence flows', async () => {
    // The message flow goes vertically from (300,50) down to (300,500),
    // crossing 3 horizontal sequence flows at y=200.
    // Flow_1: (100,200)→(200,200) — at x=300, the MF passes to the right, no cross
    // Instead, let's make sequence flows span across x=300 so the vertical MF at x=300 crosses them.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Top" name="Top Pool" processRef="Process_Top" />
    <bpmn:participant id="P_Bottom" name="Bottom Pool" processRef="Process_Bottom" />
    <bpmn:messageFlow id="MF_1" name="Cross Message" sourceRef="Task_Source" targetRef="Task_Target" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Top" isExecutable="true">
    <bpmn:task id="Task_Source" name="Source" />
    <bpmn:task id="Task_Left1" name="Left 1">
      <bpmn:outgoing>Flow_A</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_Right1" name="Right 1">
      <bpmn:incoming>Flow_A</bpmn:incoming>
    </bpmn:task>
    <bpmn:task id="Task_Left2" name="Left 2">
      <bpmn:outgoing>Flow_B</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_Right2" name="Right 2">
      <bpmn:incoming>Flow_B</bpmn:incoming>
    </bpmn:task>
    <bpmn:task id="Task_Left3" name="Left 3">
      <bpmn:outgoing>Flow_C</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_Right3" name="Right 3">
      <bpmn:incoming>Flow_C</bpmn:incoming>
    </bpmn:task>
    <bpmn:sequenceFlow id="Flow_A" sourceRef="Task_Left1" targetRef="Task_Right1" />
    <bpmn:sequenceFlow id="Flow_B" sourceRef="Task_Left2" targetRef="Task_Right2" />
    <bpmn:sequenceFlow id="Flow_C" sourceRef="Task_Left3" targetRef="Task_Right3" />
  </bpmn:process>
  <bpmn:process id="Process_Bottom" isExecutable="false">
    <bpmn:task id="Task_Target" name="Target" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Top_di" bpmnElement="P_Top" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="800" height="500" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Source_di" bpmnElement="Task_Source">
        <dc:Bounds x="250" y="30" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Left1_di" bpmnElement="Task_Left1">
        <dc:Bounds x="100" y="140" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Right1_di" bpmnElement="Task_Right1">
        <dc:Bounds x="400" y="140" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Left2_di" bpmnElement="Task_Left2">
        <dc:Bounds x="100" y="250" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Right2_di" bpmnElement="Task_Right2">
        <dc:Bounds x="400" y="250" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Left3_di" bpmnElement="Task_Left3">
        <dc:Bounds x="100" y="360" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Right3_di" bpmnElement="Task_Right3">
        <dc:Bounds x="400" y="360" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_A_di" bpmnElement="Flow_A">
        <di:waypoint x="200" y="180" />
        <di:waypoint x="400" y="180" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_B_di" bpmnElement="Flow_B">
        <di:waypoint x="200" y="290" />
        <di:waypoint x="400" y="290" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_C_di" bpmnElement="Flow_C">
        <di:waypoint x="200" y="400" />
        <di:waypoint x="400" y="400" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNShape id="P_Bottom_di" bpmnElement="P_Bottom" isHorizontal="true">
        <dc:Bounds x="0" y="550" width="800" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Target_di" bpmnElement="Task_Target">
        <dc:Bounds x="250" y="610" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="MF_1_di" bpmnElement="MF_1">
        <di:waypoint x="300" y="110" />
        <di:waypoint x="300" y="610" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(await handleImportXml({ xml }));
    const diagramId = importRes.diagramId;

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/message-flow-crossing-excessive': 'warn' },
        },
      })
    );

    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/message-flow-crossing-excessive'
    );
    // Vertical message flow at x=300 from y=110 to y=610 crosses:
    // Flow_A: horizontal at y=180 from x=200 to x=400 (x=300 is within range)
    // Flow_B: horizontal at y=290 from x=200 to x=400 (x=300 is within range)
    // Flow_C: horizontal at y=400 from x=200 to x=400 (x=300 is within range)
    // Total: 3 crossings (> threshold of 2)
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('crosses');
    expect(issues[0].message).toContain('sequence flows');
  });

  test('does not fire when message flows do not cross sequence flows', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Top" name="Top Pool" processRef="Process_Top" />
    <bpmn:participant id="P_Bottom" name="Bottom Pool" processRef="Process_Bottom" />
    <bpmn:messageFlow id="MF_1" name="Message" sourceRef="Task_Send" targetRef="Task_Receive" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Top" isExecutable="true">
    <bpmn:task id="Task_Send" name="Send" />
  </bpmn:process>
  <bpmn:process id="Process_Bottom" isExecutable="false">
    <bpmn:task id="Task_Receive" name="Receive" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Top_di" bpmnElement="P_Top" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="400" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Send_di" bpmnElement="Task_Send">
        <dc:Bounds x="150" y="60" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_Bottom_di" bpmnElement="P_Bottom" isHorizontal="true">
        <dc:Bounds x="0" y="250" width="400" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Receive_di" bpmnElement="Task_Receive">
        <dc:Bounds x="150" y="310" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="MF_1_di" bpmnElement="MF_1">
        <di:waypoint x="200" y="140" />
        <di:waypoint x="200" y="310" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(await handleImportXml({ xml }));
    const diagramId = importRes.diagramId;

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/message-flow-crossing-excessive': 'warn' },
        },
      })
    );

    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/message-flow-crossing-excessive'
    );
    expect(issues.length).toBe(0);
  });

  test('does not fire when there are no message flows', async () => {
    const diagramId = await createDiagram('No Message Flows');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Work' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/message-flow-crossing-excessive': 'warn' },
        },
      })
    );

    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/message-flow-crossing-excessive'
    );
    expect(issues.length).toBe(0);
  });
});
