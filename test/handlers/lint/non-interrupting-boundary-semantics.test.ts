/**
 * Tests for the bpmn-mcp/non-interrupting-boundary-semantics lint rule.
 *
 * This rule warns when a non-interrupting (cancelActivity=false) timer boundary
 * event's outgoing sequence flows lead exclusively to compensation throw events
 * or error end events — a pattern that is almost always semantically wrong
 * (the host task should be cancelled when the timeout fires, not run in parallel
 * with compensation).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleValidate } from '../../../src/handlers/core/validate';
import { handleImportXml } from '../../../src/handlers/core/import-xml';
import { parseResult, clearDiagrams } from '../../helpers';

const RULE = 'bpmn-mcp/non-interrupting-boundary-semantics';

/** Import BPMN XML and run lint, return issues for the target rule. */
async function lintXml(xml: string): Promise<any[]> {
  const res = await handleImportXml({ xml });
  const parsed = parseResult(res);
  const diagramId = parsed.diagramId as string;
  const lintRes = parseResult(await handleValidate({ diagramId }));
  return (lintRes.issues as any[]).filter((i) => i.rule === RULE);
}

describe('bpmnlint rule: non-interrupting-boundary-semantics', () => {
  beforeEach(() => clearDiagrams());

  const HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">`;

  test('no warning for an interrupting timer boundary event (cancelActivity=true, default)', async () => {
    const xml = `${HEADER}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_1" name="Deliver Order" />
    <bpmn:endEvent id="End_1" />
    <bpmn:endEvent id="End_Timeout">
      <bpmn:errorEventDefinition id="ErrDef_1" />
    </bpmn:endEvent>
    <bpmn:boundaryEvent id="BE_Timer" attachedToRef="Task_1" cancelActivity="true">
      <bpmn:timerEventDefinition id="TimerDef_1">
        <bpmn:timeDuration>PT45M</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="BE_Timer" targetRef="End_Timeout" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const issues = await lintXml(xml);
    expect(issues).toHaveLength(0);
  });

  test('warns for non-interrupting timer boundary event whose path leads only to error end', async () => {
    const xml = `${HEADER}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_Deliver" name="Deliver Order" />
    <bpmn:endEvent id="End_Normal" />
    <bpmn:endEvent id="End_Timeout">
      <bpmn:errorEventDefinition id="ErrDef_1" />
    </bpmn:endEvent>
    <!-- Non-interrupting timer (dashed border): cancelActivity=false -->
    <bpmn:boundaryEvent id="BE_Timer" attachedToRef="Task_Deliver" cancelActivity="false">
      <bpmn:timerEventDefinition id="TimerDef_1">
        <bpmn:timeDuration>PT45M</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_Deliver" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Deliver" targetRef="End_Normal" />
    <!-- Timer leads exclusively to error end event — semantically wrong for non-interrupting -->
    <bpmn:sequenceFlow id="Flow_3" sourceRef="BE_Timer" targetRef="End_Timeout" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const issues = await lintXml(xml);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const issue = issues[0];
    expect(issue.elementId).toBe('BE_Timer');
    // Should suggest making it interrupting
    expect(issue.message).toMatch(/cancelActivity.*true|interrupting/i);
  });

  test('warns for non-interrupting timer whose path leads only to compensation throw event', async () => {
    const xml = `${HEADER}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_1" name="Process Payment" />
    <bpmn:endEvent id="End_Normal" />
    <bpmn:intermediateThrowEvent id="CompThrow">
      <bpmn:compensateEventDefinition id="CompDef_1" />
    </bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="End_Comp" />
    <!-- Non-interrupting timer -->
    <bpmn:boundaryEvent id="BE_Timer" attachedToRef="Task_1" cancelActivity="false">
      <bpmn:timerEventDefinition id="TimerDef_1">
        <bpmn:timeDuration>PT30M</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_Normal" />
    <!-- Timer leads to compensation throw, then end — non-interrupting + compensation is wrong -->
    <bpmn:sequenceFlow id="Flow_3" sourceRef="BE_Timer" targetRef="CompThrow" />
    <bpmn:sequenceFlow id="Flow_4" sourceRef="CompThrow" targetRef="End_Comp" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const issues = await lintXml(xml);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].elementId).toBe('BE_Timer');
  });

  test('no warning when non-interrupting timer has a normal task on its path', async () => {
    const xml = `${HEADER}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_1" name="Deliver Order" />
    <bpmn:endEvent id="End_Normal" />
    <bpmn:task id="Task_Escalate" name="Send Escalation Email" />
    <bpmn:endEvent id="End_Escalate" />
    <!-- Non-interrupting timer for escalation reminder — CORRECT usage -->
    <bpmn:boundaryEvent id="BE_Timer" attachedToRef="Task_1" cancelActivity="false">
      <bpmn:timerEventDefinition id="TimerDef_1">
        <bpmn:timeDuration>PT30M</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_Normal" />
    <!-- Timer leads to a normal escalation task — this is valid non-interrupting usage -->
    <bpmn:sequenceFlow id="Flow_3" sourceRef="BE_Timer" targetRef="Task_Escalate" />
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_Escalate" targetRef="End_Escalate" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const issues = await lintXml(xml);
    expect(issues).toHaveLength(0);
  });

  test('no warning for non-interrupting message or error boundary events', async () => {
    // Rule only applies to timer boundary events
    const xml = `${HEADER}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_1" name="Wait for Payment" />
    <bpmn:endEvent id="End_Normal" />
    <bpmn:endEvent id="End_Cancelled">
      <bpmn:errorEventDefinition id="ErrDef_2" />
    </bpmn:endEvent>
    <!-- Non-interrupting message boundary event — rule should not fire for non-timer events -->
    <bpmn:boundaryEvent id="BE_Msg" attachedToRef="Task_1" cancelActivity="false">
      <bpmn:messageEventDefinition id="MsgDef_1" />
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_Normal" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="BE_Msg" targetRef="End_Cancelled" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const issues = await lintXml(xml);
    expect(issues).toHaveLength(0);
  });

  test('no warning when non-interrupting timer has no outgoing flows', async () => {
    // Edge case: no outgoing flows — rule should not report (dangling-boundary-event handles this)
    const xml = `${HEADER}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_1" name="Do Work" />
    <bpmn:endEvent id="End_1" />
    <bpmn:boundaryEvent id="BE_Timer" attachedToRef="Task_1" cancelActivity="false">
      <bpmn:timerEventDefinition id="TimerDef_1">
        <bpmn:timeDuration>PT1H</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const issues = await lintXml(xml);
    expect(issues).toHaveLength(0);
  });
});
