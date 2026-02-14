import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleValidate as handleLintDiagram,
  handleSetProperties,
  handleSetEventDefinition,
  handleImportXml,
} from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  clearDiagrams,
  connect,
  connectAll,
} from '../../helpers';

/**
 * Tests for new bpmnlint rules:
 * - service-task-missing-implementation
 * - timer-missing-definition
 * - call-activity-missing-called-element
 * - event-subprocess-missing-trigger
 * - empty-subprocess
 * - dangling-boundary-event
 * - receive-task-missing-message
 */
describe('bpmnlint new rules batch 3', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── service-task-missing-implementation ────────────────────────────────

  describe('service-task-missing-implementation', () => {
    test('warns when service task has no implementation', async () => {
      const diagramId = await createDiagram('Service Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Order',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/service-task-missing-implementation': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/service-task-missing-implementation'
      );
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('no implementation');
    });

    test('passes when service task has camunda:class', async () => {
      const diagramId = await createDiagram('Service Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Order',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:class': 'com.example.ProcessOrder' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/service-task-missing-implementation': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/service-task-missing-implementation'
      );
      expect(issues.length).toBe(0);
    });

    test('passes when service task has camunda:expression', async () => {
      const diagramId = await createDiagram('Service Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Order',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:expression': '${orderService.process(execution)}' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/service-task-missing-implementation': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/service-task-missing-implementation'
      );
      expect(issues.length).toBe(0);
    });

    test('passes when service task has camunda:type=external with topic', async () => {
      const diagramId = await createDiagram('Service Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Order',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:type': 'external', 'camunda:topic': 'process-order' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/service-task-missing-implementation': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/service-task-missing-implementation'
      );
      expect(issues.length).toBe(0);
    });

    test('passes when service task has camunda:delegateExpression', async () => {
      const diagramId = await createDiagram('Service Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Order',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:delegateExpression': '${orderDelegate}' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/service-task-missing-implementation': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/service-task-missing-implementation'
      );
      expect(issues.length).toBe(0);
    });
  });

  // ── timer-missing-definition ──────────────────────────────────────────

  describe('timer-missing-definition', () => {
    test('warns when timer event has no duration/date/cycle', async () => {
      // Import XML with a timer boundary event that has no timer properties
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <process id="Process_1" isExecutable="true">
    <startEvent id="Start" name="Start">
      <outgoing>Flow_1</outgoing>
    </startEvent>
    <userTask id="Task_1" name="Do Something">
      <incoming>Flow_1</incoming>
      <outgoing>Flow_2</outgoing>
    </userTask>
    <endEvent id="End" name="End">
      <incoming>Flow_2</incoming>
    </endEvent>
    <boundaryEvent id="Timer_1" name="Timeout" attachedToRef="Task_1">
      <outgoing>Flow_3</outgoing>
      <timerEventDefinition id="TimerDef_1" />
    </boundaryEvent>
    <endEvent id="End_Timeout" name="Timed Out">
      <incoming>Flow_3</incoming>
    </endEvent>
    <sequenceFlow id="Flow_1" sourceRef="Start" targetRef="Task_1" />
    <sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End" />
    <sequenceFlow id="Flow_3" sourceRef="Timer_1" targetRef="End_Timeout" />
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="180" y="200" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"><dc:Bounds x="280" y="178" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_di" bpmnElement="End"><dc:Bounds x="450" y="200" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Timer_1_di" bpmnElement="Timer_1"><dc:Bounds x="312" y="240" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Timeout_di" bpmnElement="End_Timeout"><dc:Bounds x="312" y="320" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="216" y="218" /><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="280" y="218" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="380" y="218" /><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="450" y="218" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3"><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="330" y="276" /><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="330" y="320" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;
      const importResult = parseResult(await handleImportXml({ xml }));
      const diagramId = importResult.diagramId;

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/timer-missing-definition': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/timer-missing-definition');
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('timeDuration');
    });

    test('passes when timer event has timeDuration', async () => {
      const diagramId = await createDiagram('Timer Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Something' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      const timerBE = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timeout',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: timerBE,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT15M' },
      });

      const timeoutEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Timed Out',
      });
      await connect(diagramId, timerBE, timeoutEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/timer-missing-definition': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/timer-missing-definition');
      expect(issues.length).toBe(0);
    });

    test('passes when timer start event has timeCycle', async () => {
      const diagramId = await createDiagram('Timer Start Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Every 10 min' });
      await handleSetEventDefinition({
        diagramId,
        elementId: start,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeCycle: 'R/PT10M' },
      });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
      await connectAll(diagramId, start, task, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/timer-missing-definition': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/timer-missing-definition');
      expect(issues.length).toBe(0);
    });
  });

  // ── call-activity-missing-called-element ──────────────────────────────

  describe('call-activity-missing-called-element', () => {
    test('warns when call activity has no calledElement', async () => {
      const diagramId = await createDiagram('Call Activity Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const callAct = await addElement(diagramId, 'bpmn:CallActivity', {
        name: 'Call Sub Process',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, callAct, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/call-activity-missing-called-element': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/call-activity-missing-called-element'
      );
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('calledElement');
    });

    test('passes when call activity has calledElement', async () => {
      const diagramId = await createDiagram('Call Activity Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const callAct = await addElement(diagramId, 'bpmn:CallActivity', {
        name: 'Call Sub Process',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, callAct, end);

      await handleSetProperties({
        diagramId,
        elementId: callAct,
        properties: { calledElement: 'my-sub-process' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/call-activity-missing-called-element': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/call-activity-missing-called-element'
      );
      expect(issues.length).toBe(0);
    });
  });

  // ── event-subprocess-missing-trigger ──────────────────────────────────

  describe('event-subprocess-missing-trigger', () => {
    test('errors when event subprocess start has no event definition', async () => {
      const diagramId = await createDiagram('Event Subprocess Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      // Create event subprocess
      const eventSub = await addElement(diagramId, 'bpmn:SubProcess', {
        name: 'Error Handler',
      });
      await handleSetProperties({
        diagramId,
        elementId: eventSub,
        properties: { triggeredByEvent: true, isExpanded: true },
      });

      // Add blank start event (no event definition) inside the event subprocess
      const subStart = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Handler Start',
        participantId: eventSub,
      });
      const subEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Handler End',
        participantId: eventSub,
      });
      await connect(diagramId, subStart, subEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/event-subprocess-missing-trigger': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/event-subprocess-missing-trigger'
      );
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('no event definition');
    });

    test('passes when event subprocess start has error event definition', async () => {
      const diagramId = await createDiagram('Event Subprocess Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      // Create event subprocess
      const eventSub = await addElement(diagramId, 'bpmn:SubProcess', {
        name: 'Error Handler',
      });
      await handleSetProperties({
        diagramId,
        elementId: eventSub,
        properties: { triggeredByEvent: true, isExpanded: true },
      });

      // Add start event with error definition inside the event subprocess
      const subStart = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Error Caught',
        participantId: eventSub,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: subStart,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
      });
      const subEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Handler End',
        participantId: eventSub,
      });
      await connect(diagramId, subStart, subEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/event-subprocess-missing-trigger': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/event-subprocess-missing-trigger'
      );
      expect(issues.length).toBe(0);
    });
  });

  // ── empty-subprocess ──────────────────────────────────────────────────

  describe('empty-subprocess', () => {
    test('warns when expanded subprocess has no flow elements', async () => {
      const diagramId = await createDiagram('Empty Subprocess Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const sub = await addElement(diagramId, 'bpmn:SubProcess', {
        name: 'Empty Sub',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, sub, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/empty-subprocess': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/empty-subprocess');
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('no flow elements');
    });

    test('passes when subprocess has flow elements', async () => {
      const diagramId = await createDiagram('Subprocess With Content');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const sub = await addElement(diagramId, 'bpmn:SubProcess', {
        name: 'Active Sub',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, sub, end);

      // Add content inside subprocess
      const subStart = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Sub Start',
        participantId: sub,
      });
      const subEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Sub End',
        participantId: sub,
      });
      await connect(diagramId, subStart, subEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/empty-subprocess': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/empty-subprocess');
      expect(issues.length).toBe(0);
    });
  });

  // ── dangling-boundary-event ───────────────────────────────────────────

  describe('dangling-boundary-event', () => {
    test('warns when boundary event has no outgoing flow', async () => {
      const diagramId = await createDiagram('Dangling Boundary Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Work' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      // Add timer boundary event without outgoing flow
      const timerBE = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timer',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: timerBE,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT1H' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/dangling-boundary-event': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/dangling-boundary-event');
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('no outgoing sequence flow');
    });

    test('passes when boundary event has outgoing flow', async () => {
      const diagramId = await createDiagram('Connected Boundary Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Work' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      const timerBE = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timer',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: timerBE,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT1H' },
      });

      const timeoutEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Timed Out',
      });
      await connect(diagramId, timerBE, timeoutEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/dangling-boundary-event': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/dangling-boundary-event');
      expect(issues.length).toBe(0);
    });

    test('skips compensation boundary events', async () => {
      const diagramId = await createDiagram('Compensation Boundary Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Charge Card',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      // Compensation boundary event — these use associations, not sequence flows
      const compBE = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Compensate',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: compBE,
        eventDefinitionType: 'bpmn:CompensateEventDefinition',
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/dangling-boundary-event': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/dangling-boundary-event');
      expect(issues.length).toBe(0);
    });
  });

  // ── receive-task-missing-message ──────────────────────────────────────

  describe('receive-task-missing-message', () => {
    test('warns when receive task has no message reference', async () => {
      const diagramId = await createDiagram('Receive Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const recvTask = await addElement(diagramId, 'bpmn:ReceiveTask', {
        name: 'Wait for Response',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, recvTask, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/receive-task-missing-message': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/receive-task-missing-message'
      );
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('no message reference');
    });
  });
});
