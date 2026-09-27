/**
 * Non-XML/SVG export_bpmn formats: static PNG, animated GIF/APNG/MP4/WebP
 * (driven by bpmn-to-image's token-simulation), and a standalone
 * interactive HTML embed. Split from export.ts for file-size compliance
 * (see export-scoped.ts for the same pattern). See ADR-022 for the
 * bpmn-to-image dependency this delegates rendering to.
 *
 * Animated/HTML rendering can fail on a missing optional dependency
 * (`gifenc`, `smol-toml`) or missing `ffmpeg` on PATH — bpmn-to-image
 * already throws a clear, actionable `Error` message in each case; this
 * module just re-wraps it as an `exportFailedError` so it surfaces as a
 * normal tool error instead of an uncaught exception.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  svgToPng,
  renderScenarioToGif,
  renderScenarioToApng,
  renderScenarioToMp4,
  renderScenarioToWebp,
  renderInteractiveHtml,
  type RenderProgress,
} from 'bpmn-to-image';
import { type ToolResult, type ToolContext } from '../../types';
import { exportFailedError } from '../../errors';
import {
  normalizePlaneElementOrder,
  checkLintGate,
  deduplicateDiElements,
  validateXmlOutput,
  adjustSvgViewBox,
} from './export-helpers';
import type { ExportBpmnArgs } from './export';

export const MEDIA_FORMATS = ['png', 'gif', 'apng', 'mp4', 'webp', 'html'] as const;
export type MediaFormat = (typeof MEDIA_FORMATS)[number];

export function isMediaFormat(format: string): format is MediaFormat {
  return (MEDIA_FORMATS as readonly string[]).includes(format);
}

export interface MediaExportArgs {
  scale?: number;
  background?: string;
  /** TOML scenario steering token-simulation for gif/apng/mp4/webp. Omit for the diagram's default scenario. */
  scenario?: string;
  fps?: number;
  /** GIF encoder: 'auto' (default) prefers ffmpeg when on PATH, else the bundled gifenc. */
  encoder?: 'auto' | 'gifenc' | 'ffmpeg';
}

function forwardProgress(context?: ToolContext): ((p: RenderProgress) => void) | undefined {
  if (!context?.sendProgress) return undefined;
  return (p: RenderProgress) => {
    void context.sendProgress!(p.current, p.total, `${p.phase}…`);
  };
}

/** Render a non-XML/SVG export_bpmn format to a Buffer, ready to write to disk. */
export async function renderMediaExport(
  format: MediaFormat,
  tightSvg: string,
  xml: string,
  args: MediaExportArgs,
  context?: ToolContext
): Promise<Buffer> {
  try {
    if (format === 'png') {
      return svgToPng(tightSvg, { scale: args.scale, background: args.background });
    }
    if (format === 'html') {
      const embed = renderInteractiveHtml(xml, { background: args.background });
      return Buffer.from(
        '<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>BPMN diagram</title></head>\n' +
          `<body>\n${embed}\n</body>\n</html>\n`,
        'utf-8'
      );
    }

    const onProgress = forwardProgress(context);
    const commonOptions = {
      scale: args.scale,
      background: args.background,
      fps: args.fps,
      onProgress,
    };
    if (format === 'gif') {
      return await renderScenarioToGif(xml, args.scenario, {
        ...commonOptions,
        encoder: args.encoder,
      });
    }
    if (format === 'apng') {
      return await renderScenarioToApng(xml, args.scenario, commonOptions);
    }
    if (format === 'mp4') {
      return await renderScenarioToMp4(xml, args.scenario, commonOptions);
    }
    return await renderScenarioToWebp(xml, args.scenario, commonOptions);
  } catch (error: any) {
    throw exportFailedError(error?.message || `Failed to render '${format}' export`);
  }
}

/** Write a rendered media buffer to disk, creating parent directories as needed. */
export function writeBufferToFile(filePath: string, data: Buffer): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, data);
}

/**
 * Render a static PNG, an animated GIF/APNG/MP4/WebP, or a standalone
 * interactive HTML embed and write it to `filePath`. Lint-gated the same
 * way as XML/SVG export; skips the connectivity/layout warnings those
 * text formats append (not meaningful for a binary/HTML artifact).
 */
export async function handleMediaExport(
  diagram: any,
  format: MediaFormat,
  args: ExportBpmnArgs,
  filePath: string,
  context?: ToolContext
): Promise<ToolResult> {
  const { skipLint = false, lintMinSeverity = 'error' } = args;

  await context?.sendProgress?.(0, 100, 'Validating diagram…');
  const lintCheck = await checkLintGate(diagram, skipLint, lintMinSeverity);
  if (lintCheck.blocked) return { content: lintCheck.content! };

  await context?.sendProgress?.(10, 100, `Rendering ${format}…`);

  const { xml: rawXml } = await diagram.modeler.saveXML({ format: true });
  const xmlOutput = deduplicateDiElements(normalizePlaneElementOrder(rawXml || ''));
  validateXmlOutput(xmlOutput);

  let tightSvg = '';
  if (format === 'png') {
    const { svg } = await diagram.modeler.saveSVG();
    tightSvg = adjustSvgViewBox(svg || '', diagram);
  }

  const buffer = await renderMediaExport(format, tightSvg, xmlOutput, args, context);
  writeBufferToFile(filePath, buffer);

  const content: ToolResult['content'] = [
    {
      type: 'text',
      text: `✅ Exported ${format.toUpperCase()} (${buffer.length.toLocaleString()} bytes) to ${filePath}`,
    },
  ];
  if (format === 'png') {
    content.push({
      type: 'image',
      data: buffer.toString('base64'),
      mimeType: 'image/png',
      annotations: { audience: ['user'] },
    });
  }
  if (lintCheck.skipLintWarning) {
    content.push({ type: 'text', text: '\n' + lintCheck.skipLintWarning });
  }

  return { content };
}
