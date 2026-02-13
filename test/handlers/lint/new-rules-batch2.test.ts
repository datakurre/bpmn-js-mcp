import { describe, test, expect, beforeEach } from 'vitest';
import { handleLintDiagram, handleSetProperties, handleImportXml } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('New bpmnlint rules (pool-size, message-flow, alignment, grouping)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── pool-size-insufficient ───────────────────────────────────────────

  describe('pool-size-insufficient', () => {
    test('warns when pool is too small for contained elements', async () => {
      // Import a diagram with a deliberately small pool containing many elements
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Small Pool" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start" />
    <bpmn:userTask id="Task_1" name="Task 1" />
    <bpmn:userTask id="Task_2" name="Task 2" />
    <bpmn:endEvent id="End_1" name="End" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="100" y="100" width="200" height="100" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="120" y="120" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="110" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="350" y="110" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="500" y="120" width="36" height="36" />
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
            rules: { 'bpmn-mcp/pool-size-insufficient': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/pool-size-insufficient');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('too small');
    });

    test('does not fire when pool is large enough', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Big Pool" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start" />
    <bpmn:endEvent id="End_1" name="End" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="100" y="100" width="800" height="300" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="200" y="220" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="500" y="220" width="36" height="36" />
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
            rules: { 'bpmn-mcp/pool-size-insufficient': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/pool-size-insufficient');
      expect(issues.length).toBe(0);
    });
  });

  // ── message-flow-necessity ───────────────────────────────────────────

  describe('message-flow-necessity', () => {
    test('warns when message flow connects tasks in two expanded pools', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Customer" name="Customer" processRef="Process_Customer" />
    <bpmn:participant id="P_Support" name="Support" processRef="Process_Support" />
    <bpmn:messageFlow id="MF_1" sourceRef="Task_Submit" targetRef="Task_Handle" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Customer" isExecutable="true">
    <bpmn:userTask id="Task_Submit" name="Submit Ticket" />
  </bpmn:process>
  <bpmn:process id="Process_Support" isExecutable="true">
    <bpmn:userTask id="Task_Handle" name="Handle Ticket" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Customer_di" bpmnElement="P_Customer" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Submit_di" bpmnElement="Task_Submit">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_Support_di" bpmnElement="P_Support" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Handle_di" bpmnElement="Task_Handle">
        <dc:Bounds x="200" y="380" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="MF_1_di" bpmnElement="MF_1">
        <di:waypoint x="250" y="160" />
        <di:waypoint x="250" y="380" />
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
            rules: { 'bpmn-mcp/message-flow-necessity': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/message-flow-necessity');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('roles within the same organization');
    });

    test('does not fire when message flow targets a collapsed pool', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Main" name="Main" processRef="Process_Main" />
    <bpmn:participant id="P_External" name="External API" />
    <bpmn:messageFlow id="MF_1" sourceRef="Task_Call" targetRef="P_External" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Main" isExecutable="true">
    <bpmn:serviceTask id="Task_Call" name="Call API" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Main_di" bpmnElement="P_Main" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Call_di" bpmnElement="Task_Call">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_External_di" bpmnElement="P_External" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="60" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="MF_1_di" bpmnElement="MF_1">
        <di:waypoint x="250" y="160" />
        <di:waypoint x="250" y="300" />
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
            rules: { 'bpmn-mcp/message-flow-necessity': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/message-flow-necessity');
      expect(issues.length).toBe(0);
    });
  });

  // ── unaligned-message-events ─────────────────────────────────────────

  describe('unaligned-message-events', () => {
    test('warns when message flow endpoints are horizontally misaligned', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_A" name="Process A" processRef="Process_A" />
    <bpmn:participant id="P_B" name="Process B" processRef="Process_B" />
    <bpmn:messageFlow id="MF_1" sourceRef="Task_Send" targetRef="Task_Receive" />
  </bpmn:collaboration>
  <bpmn:process id="Process_A" isExecutable="true">
    <bpmn:serviceTask id="Task_Send" name="Send Data" />
  </bpmn:process>
  <bpmn:process id="Process_B" isExecutable="true">
    <bpmn:serviceTask id="Task_Receive" name="Receive Data" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_A_di" bpmnElement="P_A" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Send_di" bpmnElement="Task_Send">
        <dc:Bounds x="150" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_B_di" bpmnElement="P_B" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Receive_di" bpmnElement="Task_Receive">
        <dc:Bounds x="400" y="380" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="MF_1_di" bpmnElement="MF_1">
        <di:waypoint x="200" y="160" />
        <di:waypoint x="450" y="380" />
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
            rules: { 'bpmn-mcp/unaligned-message-events': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/unaligned-message-events');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('misaligned');
      // 200 (center of Send) vs 450 (center of Receive) = 250px offset
      expect(issues[0].message).toContain('250px');
    });

    test('does not fire when endpoints are vertically aligned', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_A" name="Process A" processRef="Process_A" />
    <bpmn:participant id="P_B" name="Process B" processRef="Process_B" />
    <bpmn:messageFlow id="MF_1" sourceRef="Task_Send" targetRef="Task_Receive" />
  </bpmn:collaboration>
  <bpmn:process id="Process_A" isExecutable="true">
    <bpmn:serviceTask id="Task_Send" name="Send Data" />
  </bpmn:process>
  <bpmn:process id="Process_B" isExecutable="true">
    <bpmn:serviceTask id="Task_Receive" name="Receive Data" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_A_di" bpmnElement="P_A" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Send_di" bpmnElement="Task_Send">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_B_di" bpmnElement="P_B" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Receive_di" bpmnElement="Task_Receive">
        <dc:Bounds x="200" y="380" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="MF_1_di" bpmnElement="MF_1">
        <di:waypoint x="250" y="160" />
        <di:waypoint x="250" y="380" />
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
            rules: { 'bpmn-mcp/unaligned-message-events': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/unaligned-message-events');
      expect(issues.length).toBe(0);
    });

    test('does not fire for collapsed pool endpoints', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Main" name="Main" processRef="Process_Main" />
    <bpmn:participant id="P_Ext" name="External" />
    <bpmn:messageFlow id="MF_1" sourceRef="Task_1" targetRef="P_Ext" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Main" isExecutable="true">
    <bpmn:serviceTask id="Task_1" name="Call" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Main_di" bpmnElement="P_Main" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_Ext_di" bpmnElement="P_Ext" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="60" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="MF_1_di" bpmnElement="MF_1">
        <di:waypoint x="250" y="160" />
        <di:waypoint x="300" y="300" />
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
            rules: { 'bpmn-mcp/unaligned-message-events': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/unaligned-message-events');
      // Collapsed pool endpoint — should be skipped
      expect(issues.length).toBe(0);
    });
  });

  // ── inconsistent-assignee-grouping ───────────────────────────────────

  describe('inconsistent-assignee-grouping', () => {
    test('warns when same assignee appears in multiple lanes', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Process" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Support" name="Support">
        <bpmn:flowNodeRef>Task_Review</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Manager" name="Manager">
        <bpmn:flowNodeRef>Task_Escalate</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Also_Support</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:userTask id="Task_Review" name="Review Ticket" camunda:assignee="support-agent" />
    <bpmn:userTask id="Task_Escalate" name="Escalate Issue" camunda:assignee="manager" />
    <bpmn:userTask id="Task_Also_Support" name="Follow Up" camunda:assignee="support-agent" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="400" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Support_di" bpmnElement="Lane_Support" isHorizontal="true">
        <dc:Bounds x="30" y="0" width="570" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Manager_di" bpmnElement="Lane_Manager" isHorizontal="true">
        <dc:Bounds x="30" y="200" width="570" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Review_di" bpmnElement="Task_Review">
        <dc:Bounds x="100" y="60" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Escalate_di" bpmnElement="Task_Escalate">
        <dc:Bounds x="100" y="260" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Also_Support_di" bpmnElement="Task_Also_Support">
        <dc:Bounds x="250" y="260" width="100" height="80" />
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
            rules: { 'bpmn-mcp/inconsistent-assignee-grouping': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/inconsistent-assignee-grouping'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('support-agent');
      expect(issues[0].message).toContain('spread across');
    });

    test('does not fire when each assignee is in one lane', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Process" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Support" name="Support">
        <bpmn:flowNodeRef>Task_Review</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_FollowUp</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Manager" name="Manager">
        <bpmn:flowNodeRef>Task_Approve</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:userTask id="Task_Review" name="Review Ticket" camunda:assignee="support-agent" />
    <bpmn:userTask id="Task_FollowUp" name="Follow Up" camunda:assignee="support-agent" />
    <bpmn:userTask id="Task_Approve" name="Approve" camunda:assignee="manager" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="400" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Support_di" bpmnElement="Lane_Support" isHorizontal="true">
        <dc:Bounds x="30" y="0" width="570" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Manager_di" bpmnElement="Lane_Manager" isHorizontal="true">
        <dc:Bounds x="30" y="200" width="570" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Review_di" bpmnElement="Task_Review">
        <dc:Bounds x="100" y="60" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_FollowUp_di" bpmnElement="Task_FollowUp">
        <dc:Bounds x="250" y="60" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Approve_di" bpmnElement="Task_Approve">
        <dc:Bounds x="100" y="260" width="100" height="80" />
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
            rules: { 'bpmn-mcp/inconsistent-assignee-grouping': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/inconsistent-assignee-grouping'
      );
      expect(issues.length).toBe(0);
    });

    test('does not fire when process has no lanes', async () => {
      const diagramId = await createDiagram('No Lanes');
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });

      await handleSetProperties({
        diagramId,
        elementId: t1,
        properties: { 'camunda:assignee': 'admin' },
      });
      await handleSetProperties({
        diagramId,
        elementId: t2,
        properties: { 'camunda:assignee': 'admin' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/inconsistent-assignee-grouping': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/inconsistent-assignee-grouping'
      );
      expect(issues.length).toBe(0);
    });
  });
});
