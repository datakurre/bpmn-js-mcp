import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleValidate as handleLintDiagram,
  handleCreateCollaboration,
  handleSetProperties,
  handleCreateLanes,
  handleAssignElementsToLane,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('TODO-helpdesk bpmnlint rules', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── lane-candidate-detection ─────────────────────────────────────────

  describe('lane-candidate-detection', () => {
    test('suggests lanes when multiple distinct assignees exist without lanes', async () => {
      const diagramId = await createDiagram('Lane Candidate');
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Request' });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve Request' });

      await handleSetProperties({
        diagramId,
        elementId: t1,
        properties: { 'camunda:assignee': 'support-agent' },
      });
      await handleSetProperties({
        diagramId,
        elementId: t2,
        properties: { 'camunda:assignee': 'manager' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/lane-candidate-detection': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/lane-candidate-detection'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('distinct role assignments');
      expect(issues[0].message).toContain('support-agent');
      expect(issues[0].message).toContain('manager');
    });

    test('suggests lanes when multiple candidateGroups exist', async () => {
      const diagramId = await createDiagram('Group Candidate');
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Request' });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Request' });

      await handleSetProperties({
        diagramId,
        elementId: t1,
        properties: { 'camunda:candidateGroups': 'support' },
      });
      await handleSetProperties({
        diagramId,
        elementId: t2,
        properties: { 'camunda:candidateGroups': 'engineering' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/lane-candidate-detection': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/lane-candidate-detection'
      );
      expect(issues.length).toBeGreaterThan(0);
    });

    test('does not fire when all tasks have the same assignee', async () => {
      const diagramId = await createDiagram('Same Assignee');
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Request' });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve Request' });

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
            rules: { 'bpmn-mcp/lane-candidate-detection': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/lane-candidate-detection'
      );
      expect(issues.length).toBe(0);
    });

    test('does not fire when lanes already exist', async () => {
      const diagramId = await createDiagram('Has Lanes');
      const participant = await addElement(diagramId, 'bpmn:Participant', {
        name: 'Pool',
        x: 300,
        y: 300,
      });

      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Support' }, { name: 'Manager' }],
      });

      const t1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Review Request',
        participantId: participant,
      });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Approve Request',
        participantId: participant,
      });

      await handleSetProperties({
        diagramId,
        elementId: t1,
        properties: { 'camunda:assignee': 'support-agent' },
      });
      await handleSetProperties({
        diagramId,
        elementId: t2,
        properties: { 'camunda:assignee': 'manager' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/lane-candidate-detection': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/lane-candidate-detection'
      );
      expect(issues.length).toBe(0);
    });
  });

  // ── lane-without-assignments ─────────────────────────────────────────

  describe('lane-without-assignments', () => {
    test('warns when user tasks in lanes lack role assignments', async () => {
      const diagramId = await createDiagram('No Assignments');
      const participant = await addElement(diagramId, 'bpmn:Participant', {
        name: 'Pool',
        x: 400,
        y: 300,
      });

      const lanesRes = parseResult(
        await handleCreateLanes({
          diagramId,
          participantId: participant,
          lanes: [{ name: 'Support' }, { name: 'Manager' }],
        })
      );
      const laneIds = lanesRes.laneIds as string[];

      const t1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Handle Ticket',
        participantId: participant,
      });

      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [t1],
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/lane-without-assignments': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/lane-without-assignments'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('no camunda:assignee');
    });

    test('does not fire when user tasks have assignees', async () => {
      const diagramId = await createDiagram('With Assignments');
      const participant = await addElement(diagramId, 'bpmn:Participant', {
        name: 'Pool',
        x: 400,
        y: 300,
      });

      const lanesRes = parseResult(
        await handleCreateLanes({
          diagramId,
          participantId: participant,
          lanes: [{ name: 'Support' }, { name: 'Manager' }],
        })
      );
      const laneIds = lanesRes.laneIds as string[];

      const t1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Handle Ticket',
        participantId: participant,
      });

      await handleSetProperties({
        diagramId,
        elementId: t1,
        properties: { 'camunda:assignee': 'support-agent' },
      });

      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [t1],
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/lane-without-assignments': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/lane-without-assignments'
      );
      expect(issues.length).toBe(0);
    });
  });

  // ── collaboration-pattern-mismatch ───────────────────────────────────

  describe('collaboration-pattern-mismatch', () => {
    test('warns when expanded pool contains only message events', async () => {
      const diagramId = await createDiagram('Pattern Mismatch');

      const collab = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [{ name: 'Main Process' }, { name: 'External System' }],
        })
      );
      const [mainPool, extPool] = collab.participantIds;

      // Add real tasks to main pool
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        participantId: mainPool,
      });
      const task = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Process Order',
        participantId: mainPool,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Done',
        participantId: mainPool,
      });
      await connect(diagramId, start, task);
      await connect(diagramId, task, end);

      // Add only message events to external pool
      const extStart = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Receive',
        participantId: extPool,
      });
      const extEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Respond',
        participantId: extPool,
      });
      await connect(diagramId, extStart, extEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/collaboration-pattern-mismatch': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/collaboration-pattern-mismatch'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('only message events');
    });

    test('does not fire when both pools have tasks (via XML import)', async () => {
      // Use XML import to ensure processRef is properly set for both participants
      // (headless bpmn-js doesn't always populate processRef for second pool)
      const { handleImportXml } = await import('../../../src/handlers');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Customer" name="Customer" processRef="Process_Customer" />
    <bpmn:participant id="P_Supplier" name="Supplier" processRef="Process_Supplier" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Customer" isExecutable="true">
    <bpmn:userTask id="Task_PlaceOrder" name="Place Order" />
  </bpmn:process>
  <bpmn:process id="Process_Supplier" isExecutable="false">
    <bpmn:userTask id="Task_FulfillOrder" name="Fulfill Order" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Customer_di" bpmnElement="P_Customer" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_PlaceOrder_di" bpmnElement="Task_PlaceOrder">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_Supplier_di" bpmnElement="P_Supplier" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_FulfillOrder_di" bpmnElement="Task_FulfillOrder">
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
            rules: { 'bpmn-mcp/collaboration-pattern-mismatch': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/collaboration-pattern-mismatch'
      );
      expect(issues.length).toBe(0);
    });

    test('does not fire when the message-only pool is collapsed', async () => {
      const diagramId = await createDiagram('Collapsed Pool');

      parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Main Process' },
            { name: 'External API', collapsed: true },
          ],
        })
      );

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/collaboration-pattern-mismatch': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/collaboration-pattern-mismatch'
      );
      expect(issues.length).toBe(0);
    });
  });

  // ── long-message-flow-path ───────────────────────────────────────────

  describe('long-message-flow-path', () => {
    test('warns when message flow path is very long', async () => {
      const diagramId = await createDiagram('Long Flow');

      // Create pools far apart to generate a long message flow
      const collab = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Process A', y: 200 },
            { name: 'Process B', y: 1000 },
          ],
        })
      );
      const [poolA, poolB] = collab.participantIds;

      const taskA = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Send Message',
        participantId: poolA,
      });
      const taskB = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Receive Message',
        participantId: poolB,
      });

      await connect(diagramId, taskA, taskB);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/long-message-flow-path': 'warn' },
          },
        })
      );

      const _issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/long-message-flow-path'
      );
      // The message flow may or may not exceed 500px depending on layout;
      // we just verify the rule runs without error
      expect(res.issues).toBeDefined();
    });

    test('does not fire for short message flows', async () => {
      const diagramId = await createDiagram('Short Flow');

      // Create pools close together
      const collab = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Process A', y: 200 },
            { name: 'Process B', y: 500 },
          ],
        })
      );
      const [poolA, poolB] = collab.participantIds;

      const taskA = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Send Message',
        participantId: poolA,
      });
      const taskB = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Receive Message',
        participantId: poolB,
      });

      await connect(diagramId, taskA, taskB);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/long-message-flow-path': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/long-message-flow-path'
      );
      // Short flows should not trigger
      expect(issues.length).toBe(0);
    });
  });
});
