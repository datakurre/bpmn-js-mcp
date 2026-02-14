/**
 * File round-trip integration tests.
 *
 * Verifies the recommended workflow:
 *   import_bpmn_xml(filePath) → modify → export_bpmn(filePath)
 *
 * See TODO-timer.md §3: "Test round-trip file workflow: import → modify
 * → export to same file"
 */

import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import {
  handleImportXml,
  handleExportBpmn,
  handleSetProperties,
  handleInsertElement,
  handleLayoutDiagram,
  handleValidate,
  handleListElements,
} from '../../../src/handlers';
import { parseResult, clearDiagrams, exportXml } from '../../helpers';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const SIMPLE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                   xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true" camunda:historyTimeToLive="P180D">
    <bpmn:startEvent id="Start_1" name="Order Received">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Review" name="Review Order">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="End_1" name="Done">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_Review" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Review" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="150" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Review_di" bpmnElement="Task_Review">
        <dc:Bounds x="250" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="420" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="186" y="218" />
        <di:waypoint x="250" y="218" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="350" y="218" />
        <di:waypoint x="420" y="218" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('file round-trip: import(filePath) → modify → export(filePath)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmn-file-roundtrip-'));
  const bpmnFile = path.join(tmpDir, 'process.bpmn');

  beforeEach(() => {
    clearDiagrams();
    fs.writeFileSync(bpmnFile, SIMPLE_BPMN, 'utf-8');
  });

  afterAll(() => {
    try {
      fs.unlinkSync(bpmnFile);
      fs.rmdirSync(tmpDir);
    } catch {
      // ignore cleanup errors
    }
  });

  test('import from file, add task, export back to same file', async () => {
    // Step 1: Import from file
    const importRes = parseResult(await handleImportXml({ filePath: bpmnFile, autoLayout: false }));
    expect(importRes.success).toBe(true);
    const diagramId = importRes.diagramId;

    // Step 2: Insert a service task between Review and End
    const xml1 = await exportXml(diagramId);
    const flowMatch = xml1.match(/sequenceFlow id="([^"]+)"[^>]*sourceRef="Task_Review"/i);
    expect(flowMatch).toBeTruthy();
    const insertRes = parseResult(
      await handleInsertElement({
        diagramId,
        flowId: flowMatch![1],
        elementType: 'bpmn:ServiceTask',
        name: 'Process Payment',
      })
    );
    expect(insertRes.success).toBe(true);

    // Step 3: Export back to the same file
    const exportRes = await handleExportBpmn({
      diagramId,
      format: 'xml',
      filePath: bpmnFile,
      skipLint: true,
    });
    const allText = exportRes.content.map((c: any) => c.text).join('\n');
    expect(allText).toContain('Written to');

    // Step 4: Verify file was written
    const written = fs.readFileSync(bpmnFile, 'utf-8');
    expect(written).toContain('Process Payment');
    expect(written).toContain('Review Order');
    expect(written).toContain('Order Received');
    expect(written).toContain('Done');
  });

  test('file round-trip preserves existing elements after modification', async () => {
    // Import
    const importRes = parseResult(await handleImportXml({ filePath: bpmnFile, autoLayout: false }));
    const diagramId = importRes.diagramId;

    // Modify: rename the task
    await handleSetProperties({
      diagramId,
      elementId: 'Task_Review',
      properties: { name: 'Verify Order Details' },
    });

    // Export back to file
    await handleExportBpmn({
      diagramId,
      format: 'xml',
      filePath: bpmnFile,
      skipLint: true,
    });

    // Re-import and verify
    const reimportRes = parseResult(
      await handleImportXml({ filePath: bpmnFile, autoLayout: false })
    );
    const elems = parseResult(await handleListElements({ diagramId: reimportRes.diagramId }));
    const names = elems.elements.map((e: any) => e.name).filter(Boolean);
    expect(names).toContain('Verify Order Details');
    expect(names).not.toContain('Review Order');
    expect(names).toContain('Order Received');
    expect(names).toContain('Done');
  });

  test('file round-trip with layout produces valid diagram', async () => {
    // Import
    const importRes = parseResult(await handleImportXml({ filePath: bpmnFile, autoLayout: false }));
    const diagramId = importRes.diagramId;

    // Insert a task
    const xml = await exportXml(diagramId);
    const flowMatch = xml.match(/sequenceFlow id="([^"]+)"[^>]*sourceRef="Task_Review"/i);
    expect(flowMatch).toBeTruthy();
    await handleInsertElement({
      diagramId,
      flowId: flowMatch![1],
      elementType: 'bpmn:UserTask',
      name: 'Approve Order',
    });

    // Layout
    await handleLayoutDiagram({ diagramId });

    // Export to file
    await handleExportBpmn({
      diagramId,
      format: 'xml',
      filePath: bpmnFile,
      skipLint: true,
    });

    // Re-import the written file and validate
    const reimportRes = parseResult(
      await handleImportXml({ filePath: bpmnFile, autoLayout: false })
    );
    expect(reimportRes.success).toBe(true);

    // Validate — only errors matter
    const lintRes = parseResult(await handleValidate({ diagramId: reimportRes.diagramId }));
    const errors = (lintRes.issues || []).filter((i: any) => i.severity === 'error');
    expect(errors).toEqual([]);

    // Verify all elements present
    const elems = parseResult(await handleListElements({ diagramId: reimportRes.diagramId }));
    const names = elems.elements.map((e: any) => e.name).filter(Boolean);
    expect(names).toContain('Order Received');
    expect(names).toContain('Review Order');
    expect(names).toContain('Approve Order');
    expect(names).toContain('Done');
  });

  test('export to file creates intermediate directories', async () => {
    // Import
    const importRes = parseResult(await handleImportXml({ filePath: bpmnFile, autoLayout: false }));
    const diagramId = importRes.diagramId;

    // Export to a nested path that doesn't exist yet
    const nestedFile = path.join(tmpDir, 'sub', 'dir', 'output.bpmn');
    const exportRes = await handleExportBpmn({
      diagramId,
      format: 'xml',
      filePath: nestedFile,
      skipLint: true,
    });
    const allText = exportRes.content.map((c: any) => c.text).join('\n');
    expect(allText).toContain('Written to');

    // Verify file exists
    expect(fs.existsSync(nestedFile)).toBe(true);
    const content = fs.readFileSync(nestedFile, 'utf-8');
    expect(content).toContain('Review Order');

    // Cleanup nested dirs
    try {
      fs.unlinkSync(nestedFile);
      fs.rmdirSync(path.join(tmpDir, 'sub', 'dir'));
      fs.rmdirSync(path.join(tmpDir, 'sub'));
    } catch {
      // ignore
    }
  });
});
