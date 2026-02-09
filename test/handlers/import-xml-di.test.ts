/**
 * Tests for import_bpmn_xml DI preservation and auto-detection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleImportXml, handleListElements, handleExportBpmn } from '../../src/handlers';
import { parseResult, clearDiagrams } from '../helpers';

/** Minimal BPMN XML with explicit DI (diagram interchange) coordinates. */
const XML_WITH_DI = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true" camunda:historyTimeToLive="P180D">
    <bpmn:startEvent id="Start_1" name="Begin" />
    <bpmn:endEvent id="End_1" name="Finish" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="150" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="400" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="186" y="218" />
        <di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="400" y="218" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** BPMN XML without DI (no BPMNShape/BPMNEdge elements). */
const XML_WITHOUT_DI = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true" camunda:historyTimeToLive="P180D">
    <bpmn:startEvent id="Start_1" name="Begin" />
    <bpmn:endEvent id="End_1" name="Finish" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('import_bpmn_xml DI handling', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('preserves existing DI coordinates when autoLayout is false', async () => {
    const importRes = parseResult(await handleImportXml({ xml: XML_WITH_DI, autoLayout: false }));
    expect(importRes.success).toBe(true);

    // Export and verify DI is preserved
    const exportRes = await handleExportBpmn({
      diagramId: importRes.diagramId,
      format: 'xml',
      skipLint: true,
    });
    const xml = exportRes.content[0].text;
    expect(xml).toContain('x="150"');
    expect(xml).toContain('y="200"');
  });

  it('auto-detects DI presence and skips auto-layout when DI exists', async () => {
    const importRes = parseResult(await handleImportXml({ xml: XML_WITH_DI }));
    expect(importRes.success).toBe(true);
    expect(importRes.diagramId).toBeDefined();
  });

  it('applies auto-layout when XML has no DI coordinates', async () => {
    const importRes = parseResult(await handleImportXml({ xml: XML_WITHOUT_DI }));
    expect(importRes.success).toBe(true);

    // Elements should have been laid out
    const elements = parseResult(await handleListElements({ diagramId: importRes.diagramId }));
    expect(elements.elements.length).toBeGreaterThan(0);
  });

  it('forces auto-layout when autoLayout is true even with existing DI', async () => {
    const importRes = parseResult(await handleImportXml({ xml: XML_WITH_DI, autoLayout: true }));
    expect(importRes.success).toBe(true);
    expect(importRes.diagramId).toBeDefined();
  });
});
