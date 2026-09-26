/**
 * Tests for export_bpmn's non-XML/SVG formats: png, animated gif/apng/mp4/webp
 * (token-simulation via bpmn-to-image), and html (interactive embed).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { handleExportBpmn } from '../../../src/handlers';
import { createDiagram, createSimpleProcess, clearDiagrams } from '../../helpers';

describe('export_bpmn — media formats', () => {
  let tmpDir: string;

  beforeEach(() => {
    clearDiagrams();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmn-mcp-export-media-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('png format requires filePath', async () => {
    const diagramId = await createDiagram('PNG no path');
    await createSimpleProcess(diagramId);

    await expect(handleExportBpmn({ diagramId, format: 'png' } as any)).rejects.toThrow(
      /must be written to a file/
    );
  });

  test('gif format is rejected together with elementId', async () => {
    const diagramId = await createDiagram('Scoped gif');
    const { task } = await createSimpleProcess(diagramId);
    const filePath = path.join(tmpDir, 'out.gif');

    await expect(
      handleExportBpmn({ diagramId, format: 'gif', elementId: task, filePath } as any)
    ).rejects.toThrow(/not supported together with elementId/);
  });

  test('png format writes a PNG file and returns a confirmation + image preview', async () => {
    const diagramId = await createDiagram('PNG export');
    await createSimpleProcess(diagramId);
    const filePath = path.join(tmpDir, 'diagram.png');

    const result = await handleExportBpmn({
      diagramId,
      format: 'png',
      filePath,
      skipLint: true,
    } as any);

    expect(fs.existsSync(filePath)).toBe(true);
    const written = fs.readFileSync(filePath);
    // PNG magic bytes
    expect(written[0]).toBe(0x89);
    expect(written[1]).toBe(0x50);

    const textItem = result.content.find((c: any) => c.type === 'text') as any;
    expect(textItem.text).toContain('Exported PNG');
    expect(textItem.text).toContain(filePath);

    const imageItem = result.content.find((c: any) => c.type === 'image') as any;
    expect(imageItem).toBeDefined();
    expect(imageItem.mimeType).toBe('image/png');
  });

  test('html format writes a standalone interactive embed', async () => {
    const diagramId = await createDiagram('HTML export');
    await createSimpleProcess(diagramId);
    const filePath = path.join(tmpDir, 'diagram.html');

    const result = await handleExportBpmn({
      diagramId,
      format: 'html',
      filePath,
      skipLint: true,
    } as any);

    expect(fs.existsSync(filePath)).toBe(true);
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toContain('<!doctype html>');
    expect(written).toContain('TokenSimulation(');

    const textItem = result.content.find((c: any) => c.type === 'text') as any;
    expect(textItem.text).toContain('Exported HTML');
    // Binary/HTML formats return a confirmation only, not the full markup inline.
    expect(textItem.text).not.toContain('<!doctype html>');
  });

  test("gif format renders the diagram's own default scenario when none is given", async () => {
    const diagramId = await createDiagram('GIF export');
    await createSimpleProcess(diagramId);
    const filePath = path.join(tmpDir, 'diagram.gif');

    const result = await handleExportBpmn({
      diagramId,
      format: 'gif',
      filePath,
      skipLint: true,
    } as any);

    expect(fs.existsSync(filePath)).toBe(true);
    const written = fs.readFileSync(filePath);
    // GIF magic bytes: "GIF87a" or "GIF89a"
    expect(written.subarray(0, 3).toString('ascii')).toBe('GIF');

    const textItem = result.content.find((c: any) => c.type === 'text') as any;
    expect(textItem.text).toContain('Exported GIF');
  }, 30000);

  test('mp4 format surfaces a clear error when ffmpeg is unavailable, without writing a partial file', async () => {
    const diagramId = await createDiagram('MP4 export');
    await createSimpleProcess(diagramId);
    const filePath = path.join(tmpDir, 'diagram.mp4');

    try {
      await handleExportBpmn({ diagramId, format: 'mp4', filePath, skipLint: true } as any);
      // If ffmpeg happens to be available in this environment, the export
      // should still succeed cleanly — nothing further to assert here.
    } catch (error: any) {
      expect(error.message).toMatch(/ffmpeg/i);
      // No half-written file should be left behind on failure.
      expect(fs.existsSync(filePath)).toBe(false);
    }
  }, 30000);

  test('lint gate still blocks media export when errors exist and skipLint is not set', async () => {
    const diagramId = await createDiagram('Lint blocked media');
    // A bare start event with no other content trips bpmnlint errors.
    const filePath = path.join(tmpDir, 'blocked.png');

    const result = await handleExportBpmn({
      diagramId,
      format: 'png',
      filePath,
    } as any);

    expect(fs.existsSync(filePath)).toBe(false);
    const textItem = result.content.find((c: any) => c.type === 'text') as any;
    expect(textItem.text).toContain('Export blocked');
  });
});
