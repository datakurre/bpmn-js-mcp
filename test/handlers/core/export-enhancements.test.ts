import { describe, test, expect, beforeEach } from 'vitest';
import { handleExportBpmn, handleImportXml } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('export_bpmn — enhancements', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── Both format ─────────────────────────────────────────────────────────

  describe('format: both', () => {
    test('returns XML and SVG in a single call', async () => {
      const diagramId = await createDiagram();
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        x: 100,
        y: 100,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 300, y: 100 });
      await connect(diagramId, start, end);

      const res = await handleExportBpmn({ diagramId, format: 'both' });
      // First content block should be XML
      expect(res.content[0].text).toContain('<bpmn:definitions');
      // Second content block should be SVG
      expect(res.content[1].text).toContain('<svg');
    });

    test('both format works with skipLint', async () => {
      const diagramId = await createDiagram();
      await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });

      const res = await handleExportBpmn({ diagramId, format: 'both', skipLint: true });
      expect(res.content[0].text).toContain('<bpmn:definitions');
      expect(res.content[1].text).toContain('<svg');
    });
  });

  // ── filePath export ─────────────────────────────────────────────────────

  describe('filePath export', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmn-export-'));
    });

    test('writes XML to file when filePath is specified', async () => {
      const diagramId = await createDiagram();
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        x: 100,
        y: 100,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 300, y: 100 });
      await connect(diagramId, start, end);

      const outPath = path.join(tmpDir, 'test.bpmn');
      const res = await handleExportBpmn({
        diagramId,
        format: 'xml',
        filePath: outPath,
      });

      // Check file was written
      expect(fs.existsSync(outPath)).toBe(true);
      const fileContent = fs.readFileSync(outPath, 'utf-8');
      expect(fileContent).toContain('<bpmn:definitions');

      // Check response mentions the file
      const texts = res.content.map((c) => c.text).join('\n');
      expect(texts).toContain('Written to');
    });

    test('writes XML for both format', async () => {
      const diagramId = await createDiagram();
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        x: 100,
        y: 100,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 300, y: 100 });
      await connect(diagramId, start, end);

      const outPath = path.join(tmpDir, 'test.bpmn');
      const res = await handleExportBpmn({
        diagramId,
        format: 'both',
        filePath: outPath,
      });

      // File should contain XML (first content block)
      const fileContent = fs.readFileSync(outPath, 'utf-8');
      expect(fileContent).toContain('<bpmn:definitions');

      // Response should include both XML and SVG
      expect(res.content[0].text).toContain('<bpmn:definitions');
      expect(res.content[1].text).toContain('<svg');
    });

    test('creates directories automatically', async () => {
      const diagramId = await createDiagram();
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        x: 100,
        y: 100,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 300, y: 100 });
      await connect(diagramId, start, end);

      const outPath = path.join(tmpDir, 'nested', 'dir', 'test.bpmn');
      await handleExportBpmn({
        diagramId,
        format: 'xml',
        filePath: outPath,
      });

      expect(fs.existsSync(outPath)).toBe(true);
    });
  });

  // ── XML validation ──────────────────────────────────────────────────────

  describe('XML validation', () => {
    test('exported XML contains well-formed structure', async () => {
      const diagramId = await createDiagram();
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        x: 100,
        y: 100,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 300, y: 100 });
      await connect(diagramId, start, end);

      const res = await handleExportBpmn({ diagramId, format: 'xml' });
      const xml = res.content[0].text;
      expect(xml).toContain('<?xml');
      expect(xml).toContain('</bpmn:definitions>');
    });
  });
});

describe('import_bpmn_xml — enhancements', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('filePath import', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmn-import-'));
    });

    test('imports from a file path', async () => {
      // Write a valid BPMN file
      const bpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Begin"/>
    <bpmn:endEvent id="End_1" name="Finish"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="End_1"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="179" y="79" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="350" y="79" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="215" y="97"/>
        <di:waypoint x="350" y="97"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

      const filePath = path.join(tmpDir, 'test.bpmn');
      fs.writeFileSync(filePath, bpmnXml, 'utf-8');

      const res = await handleImportXml({ filePath });
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(true);
      expect(data.diagramId).toBeDefined();
      expect(data.sourceFile).toBe(filePath);
      expect(data.message).toContain(filePath);
    });

    test('returns error for non-existent file', async () => {
      const filePath = path.join(tmpDir, 'nonexistent.bpmn');
      const res = await handleImportXml({ filePath });
      expect(res.content[0].text).toContain('File not found');
    });

    test('returns error when neither xml nor filePath provided', async () => {
      const res = await handleImportXml({});
      expect(res.content[0].text).toContain('Either xml or filePath must be provided');
    });

    test('round-trip: import from file, export to file', async () => {
      // Create a diagram, export to file, then import from file
      const diagramId = await createDiagram();
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        x: 100,
        y: 100,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 300, y: 100 });
      await connect(diagramId, start, end);

      const exportPath = path.join(tmpDir, 'roundtrip.bpmn');
      await handleExportBpmn({
        diagramId,
        format: 'xml',
        filePath: exportPath,
      });

      // Import from the exported file
      const importRes = await handleImportXml({ filePath: exportPath });
      const importData = JSON.parse(importRes.content[0].text);
      expect(importData.success).toBe(true);

      // Export from the imported diagram and verify
      const reExportRes = await handleExportBpmn({
        diagramId: importData.diagramId,
        format: 'xml',
        skipLint: true,
      });
      expect(reExportRes.content[0].text).toContain('Start');
      expect(reExportRes.content[0].text).toContain('End');
    });
  });
});
