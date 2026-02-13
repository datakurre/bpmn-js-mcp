/**
 * Tests for file-path import correctness.
 *
 * Verifies that importing two different BPMN files (even with the same
 * Definitions ID) produces distinct, correct diagram instances.
 * Regression test for AP-4 (file-path import stale data).
 */

import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { handleImportXml, handleListElements } from '../../../src/handlers';
import { parseResult, clearDiagrams } from '../../helpers';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** BPMN XML with a single task named "Task A" and shared Definitions_1 ID. */
const XML_FILE_A = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true" camunda:historyTimeToLive="P180D">
    <bpmn:startEvent id="Start_1" name="Begin A" />
    <bpmn:task id="Task_A" name="Task Alpha" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_A" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="150" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_A_di" bpmnElement="Task_A">
        <dc:Bounds x="250" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="186" y="218" />
        <di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="250" y="218" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** BPMN XML with two tasks named "Task B1" and "Task B2" — same Definitions_1 ID. */
const XML_FILE_B = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true" camunda:historyTimeToLive="P180D">
    <bpmn:startEvent id="Start_B" name="Begin B" />
    <bpmn:task id="Task_B1" name="Task Beta One" />
    <bpmn:task id="Task_B2" name="Task Beta Two" />
    <bpmn:sequenceFlow id="Flow_B1" sourceRef="Start_B" targetRef="Task_B1" />
    <bpmn:sequenceFlow id="Flow_B2" sourceRef="Task_B1" targetRef="Task_B2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_B_di" bpmnElement="Start_B">
        <dc:Bounds x="150" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_B1_di" bpmnElement="Task_B1">
        <dc:Bounds x="250" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_B2_di" bpmnElement="Task_B2">
        <dc:Bounds x="420" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_B1_di" bpmnElement="Flow_B1">
        <di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="186" y="218" />
        <di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="250" y="218" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_B2_di" bpmnElement="Flow_B2">
        <di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="350" y="218" />
        <di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="420" y="218" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('import_bpmn_xml — file-path distinct diagrams (AP-4)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmn-import-test-'));
  const fileA = path.join(tmpDir, 'file-a.bpmn');
  const fileB = path.join(tmpDir, 'file-b.bpmn');

  beforeEach(() => {
    clearDiagrams();
    fs.writeFileSync(fileA, XML_FILE_A, 'utf-8');
    fs.writeFileSync(fileB, XML_FILE_B, 'utf-8');
  });

  afterAll(() => {
    // Clean up temp files
    try {
      fs.unlinkSync(fileA);
      fs.unlinkSync(fileB);
      fs.rmdirSync(tmpDir);
    } catch {
      // ignore cleanup errors
    }
  });

  test('imports two files with same Definitions ID and returns distinct elements', async () => {
    // Import file A
    const resA = parseResult(await handleImportXml({ filePath: fileA, autoLayout: false }));
    expect(resA.success).toBe(true);

    // Import file B
    const resB = parseResult(await handleImportXml({ filePath: fileB, autoLayout: false }));
    expect(resB.success).toBe(true);

    // Both should have different diagram IDs
    expect(resA.diagramId).not.toBe(resB.diagramId);

    // List elements for each diagram
    const elemsA = parseResult(await handleListElements({ diagramId: resA.diagramId }));
    const elemsB = parseResult(await handleListElements({ diagramId: resB.diagramId }));

    // File A should have "Task Alpha", not "Task Beta"
    const namesA = elemsA.elements.map((e: any) => e.name).filter(Boolean);
    expect(namesA).toContain('Task Alpha');
    expect(namesA).not.toContain('Task Beta One');
    expect(namesA).not.toContain('Task Beta Two');

    // File B should have "Task Beta One" and "Task Beta Two", not "Task Alpha"
    const namesB = elemsB.elements.map((e: any) => e.name).filter(Boolean);
    expect(namesB).toContain('Task Beta One');
    expect(namesB).toContain('Task Beta Two');
    expect(namesB).not.toContain('Task Alpha');
  });

  test('file-path import returns correct element count', async () => {
    // File A: Start + Task + Flow = 3 flow elements
    const resA = parseResult(await handleImportXml({ filePath: fileA, autoLayout: false }));
    const elemsA = parseResult(await handleListElements({ diagramId: resA.diagramId }));
    const flowElementsA = elemsA.elements.filter(
      (e: any) => e.type !== 'bpmn:Process' && e.type !== 'label'
    );
    expect(flowElementsA.length).toBe(3); // Start_1, Task_A, Flow_1

    // File B: Start + Task + Task + Flow + Flow = 5 flow elements
    const resB = parseResult(await handleImportXml({ filePath: fileB, autoLayout: false }));
    const elemsB = parseResult(await handleListElements({ diagramId: resB.diagramId }));
    const flowElementsB = elemsB.elements.filter(
      (e: any) => e.type !== 'bpmn:Process' && e.type !== 'label'
    );
    expect(flowElementsB.length).toBe(5); // Start_B, Task_B1, Task_B2, Flow_B1, Flow_B2
  });
});
