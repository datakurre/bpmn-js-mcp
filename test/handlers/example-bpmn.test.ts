import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { handleImportXml, handleExportBpmn } from '../../src/handlers';
import { parseResult, clearDiagrams } from '../helpers';

const EXAMPLE_BPMN_PATH = path.resolve(__dirname, '../../example.bpmn');

describe('example.bpmn validation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('parses and imports without errors', async () => {
    const xml = fs.readFileSync(EXAMPLE_BPMN_PATH, 'utf-8');
    expect(xml).toContain('</bpmn:definitions>');

    const res = parseResult(await handleImportXml({ xml, autoLayout: false }));
    expect(res.success).toBe(true);
    expect(res.diagramId).toMatch(/^diagram_/);
  });

  it('exports valid XML after round-trip', async () => {
    const xml = fs.readFileSync(EXAMPLE_BPMN_PATH, 'utf-8');
    const imported = parseResult(await handleImportXml({ xml, autoLayout: false }));

    const exportResult = await handleExportBpmn({
      diagramId: imported.diagramId,
      format: 'xml',
      skipLint: true,
    });
    const exportedXml = exportResult.content[0].text;
    expect(exportedXml).toContain('</bpmn:definitions>');
    expect(exportedXml).toContain('bpmndi:BPMNShape');
    expect(exportedXml).toContain('bpmndi:BPMNEdge');
  });

  it('exports SVG without errors', async () => {
    const xml = fs.readFileSync(EXAMPLE_BPMN_PATH, 'utf-8');
    const imported = parseResult(await handleImportXml({ xml, autoLayout: false }));

    const svgResult = await handleExportBpmn({
      diagramId: imported.diagramId,
      format: 'svg',
      skipLint: true,
    });
    const svg = svgResult.content[0].text;
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });
});
