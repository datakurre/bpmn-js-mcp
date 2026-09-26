import { describe, test, expect, beforeEach } from 'vitest';
import { handleImportXml } from '../../../src/handlers';
import { INITIAL_XML, getDiagram } from '../../../src/diagram-manager';
import { parseResult, clearDiagrams } from '../../helpers';

// ── Minimal BPMN fixtures ──────────────────────────────────────────────────

/** Simple linear process: start → task → end (no gateways, no subprocesses). */
const SIMPLE_LINEAR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start"/>
    <bpmn:task id="Task_1" name="Do Work"/>
    <bpmn:endEvent id="End_1" name="Done"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1"/>
  </bpmn:process>
</bpmn:definitions>`;

/** Process with an exclusive gateway. */
const GATEWAY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start"/>
    <bpmn:exclusiveGateway id="GW_1" name="Check"/>
    <bpmn:task id="Task_A" name="Path A"/>
    <bpmn:task id="Task_B" name="Path B"/>
    <bpmn:endEvent id="End_1" name="Done"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="GW_1"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="GW_1" targetRef="Task_A"/>
    <bpmn:sequenceFlow id="Flow_3" sourceRef="GW_1" targetRef="Task_B"/>
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_A" targetRef="End_1"/>
    <bpmn:sequenceFlow id="Flow_5" sourceRef="Task_B" targetRef="End_1"/>
  </bpmn:process>
</bpmn:definitions>`;

/** Process with a subprocess. */
const SUBPROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start"/>
    <bpmn:subProcess id="Sub_1" name="Sub">
      <bpmn:startEvent id="SubStart_1" name="Sub Start"/>
      <bpmn:endEvent id="SubEnd_1" name="Sub End"/>
      <bpmn:sequenceFlow id="SubFlow_1" sourceRef="SubStart_1" targetRef="SubEnd_1"/>
    </bpmn:subProcess>
    <bpmn:endEvent id="End_1" name="Done"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Sub_1"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Sub_1" targetRef="End_1"/>
  </bpmn:process>
</bpmn:definitions>`;

describe('import_bpmn_xml', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('imports valid BPMN XML and returns a new diagramId', async () => {
    const res = parseResult(await handleImportXml({ xml: INITIAL_XML }));
    expect(res.success).toBe(true);
    expect(res.diagramId).toMatch(/^diagram_/);
  });

  // ── Auto-layout on import ────────────────────────────────────────────────

  function registryOf(diagramId: string): any {
    return getDiagram(diagramId)!.modeler.get('elementRegistry');
  }

  test('lays out a simple linear process left to right', async () => {
    const res = parseResult(await handleImportXml({ xml: SIMPLE_LINEAR_XML, autoLayout: true }));
    expect(res.success).toBe(true);
    expect(res.autoLayoutApplied).toBe(true);
    const reg = registryOf(res.diagramId);
    expect(reg.get('Start_1').x).toBeLessThan(reg.get('Task_1').x);
    expect(reg.get('Task_1').x).toBeLessThan(reg.get('End_1').x);
  });

  test('lays out gateway branches without overlap', async () => {
    const res = parseResult(await handleImportXml({ xml: GATEWAY_XML, autoLayout: true }));
    expect(res.autoLayoutApplied).toBe(true);
    const reg = registryOf(res.diagramId);
    const a = reg.get('Task_A');
    const b = reg.get('Task_B');
    expect(a.x).toBeGreaterThan(reg.get('GW_1').x);
    expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(a.height);
  });

  test('places subprocess children inside the subprocess', async () => {
    const res = parseResult(await handleImportXml({ xml: SUBPROCESS_XML, autoLayout: true }));
    expect(res.autoLayoutApplied).toBe(true);
    const reg = registryOf(res.diagramId);
    const sub = reg.get('Sub_1');
    for (const id of ['SubStart_1', 'SubEnd_1']) {
      const el = reg.get(id);
      expect(el.x).toBeGreaterThanOrEqual(sub.x);
      expect(el.y).toBeGreaterThanOrEqual(sub.y);
      expect(el.x + el.width).toBeLessThanOrEqual(sub.x + sub.width);
      expect(el.y + el.height).toBeLessThanOrEqual(sub.y + sub.height);
    }
  });

  test('preserves Camunda extension attributes through auto-layout', async () => {
    const xml = SIMPLE_LINEAR_XML.replace(
      'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
      'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:camunda="http://camunda.org/schema/1.0/bpmn"'
    ).replace('<bpmn:task id="Task_1"', '<bpmn:userTask camunda:assignee="demo" id="Task_1"');
    expect(xml).toContain('camunda:assignee="demo"');
    const res = parseResult(await handleImportXml({ xml, autoLayout: true }));
    expect(res.autoLayoutApplied).toBe(true);
    const task = registryOf(res.diagramId).get('Task_1');
    expect(task.businessObject.assignee).toBe('demo');
  });

  test('keeps embedded DI when autoLayout is false', async () => {
    // INITIAL_XML already has DI coordinates so autoLayout: false works
    const res = parseResult(await handleImportXml({ xml: INITIAL_XML, autoLayout: false }));
    expect(res.success).toBe(true);
    expect(res.autoLayoutApplied).toBe(false);
  });
});
