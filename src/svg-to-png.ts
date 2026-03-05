/**
 * SVG-to-PNG conversion using @resvg/resvg-js.
 *
 * Converts SVG strings (as produced by bpmn-js `saveSVG()`) into PNG buffers
 * suitable for inclusion as base64-encoded `ImageContent` items in MCP tool
 * responses.
 *
 * resvg-js is a Rust-based SVG renderer compiled to a native addon — no
 * Canvas / node-gyp build chain required.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

/**
 * Platform-specific system font directories.
 *
 * @resvg/resvg-js has no access to system fonts by default — text labels
 * render as empty boxes when no font paths are provided.  We scan these
 * directories for TTF/OTF font files and pass them via `fontFiles` to the
 * Rust renderer, enabling it to find and rasterize fonts used by bpmn-js
 * SVG output (typically `font-family: Arial, sans-serif`).
 */
const SYSTEM_FONT_DIRS: string[] = ((): string[] => {
  switch (process.platform) {
    case 'linux':
      return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts')];
    case 'darwin':
      return ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts')];
    case 'win32':
      return ['C:\\Windows\\Fonts'];
    default:
      return [];
  }
})();

/** Font file extensions supported by resvg-js. */
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

/**
 * Recursively collect font files from a directory.
 * Silently skips directories that don't exist or can't be read.
 */
function collectFontFiles(dir: string): string[] {
  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files; // directory doesn't exist or permission denied
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFontFiles(fullPath));
    } else if (entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Lazily collected system font file paths (collected once on first use). */
let _cachedFontFiles: string[] | null = null;

function getSystemFontFiles(): string[] {
  if (_cachedFontFiles !== null) return _cachedFontFiles;
  const files: string[] = [];
  for (const dir of SYSTEM_FONT_DIRS) {
    files.push(...collectFontFiles(dir));
  }
  _cachedFontFiles = files;
  return files;
}

/**
 * Convert an SVG string to a PNG buffer.
 *
 * Provides `fontFiles` so the Rust renderer can find system fonts and render
 * text labels inside BPMN diagrams.
 *
 * @param svg   The SVG markup (e.g. from `modeler.saveSVG()`)
 * @returns     A Buffer containing the PNG image data
 */
export function svgToPng(svg: string): Buffer {
  const fontFiles = getSystemFontFiles();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'original' as const },
    font: {
      fontFiles,
      // Disable the built-in system font scanner so we control exactly
      // which files are loaded (avoids slow scanning and permission issues).
      loadSystemFonts: false,
    },
  });
  const rendered = resvg.render();
  return Buffer.from(rendered.asPng());
}
