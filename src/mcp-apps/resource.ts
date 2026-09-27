/**
 * `ui://bpmn-diagram-viewer` — the MCP Apps (issue #11 / ADR-025) resource
 * page. A single static, diagram-agnostic HTML page: bpmn-to-image's own
 * interactive-viewer bundle (bpmn-js NavigatedViewer + token-simulation),
 * plus `viewer-entry.ts`'s small MCP Apps View glue script that re-renders
 * whichever diagram XML arrives via `ontoolresult`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderInteractiveAssetsHtml } from 'bpmn-to-image';

/** `ui://` scheme is required — hosts only look for MCP Apps UI at this prefix. */
export const APP_VIEWER_RESOURCE_URI = 'ui://bpmn-diagram-viewer';

/** Per the ext-apps spec: identifies HTML content as an MCP App UI resource. */
export const APP_VIEWER_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * Resolve `dist/mcp-apps-viewer-bundle.js`, built by esbuild.config.mjs's
 * `mcp-apps-viewer-bundle` target alongside `dist/index.js`.
 *
 * esbuild bundles this file directly into `dist/index.js`, so at runtime
 * `__dirname` is `dist/` itself (not `dist/mcp-apps/` — esbuild flattens the
 * source tree into one file) and the bundle sits right next to it. Under
 * `ts-node`/vitest, this file instead runs from its own source location
 * (`src/mcp-apps/`), two directories above the repo's `dist/`.
 */
function findViewerBundle(): string {
  const candidates = [
    path.resolve(__dirname, 'mcp-apps-viewer-bundle.js'),
    path.resolve(__dirname, '..', 'mcp-apps-viewer-bundle.js'),
    path.resolve(__dirname, '..', '..', 'dist', 'mcp-apps-viewer-bundle.js'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;

  throw new Error(
    'dist/mcp-apps-viewer-bundle.js not found — run `npm run build` before serving ' +
      `${APP_VIEWER_RESOURCE_URI}.`
  );
}

let cachedHtml: string | undefined;

/** Build (and cache) the full self-contained HTML page for the resource. */
export function renderAppViewerHtml(): string {
  if (cachedHtml === undefined) {
    const assets = renderInteractiveAssetsHtml();
    const viewerScript = fs.readFileSync(findViewerBundle(), 'utf-8');
    cachedHtml = [
      '<!doctype html>',
      '<html>',
      '<head><meta charset="utf-8"><title>BPMN diagram</title>',
      assets,
      '</head>',
      '<body>',
      '<span id="bpmn-app-view" style="display:block;width:100%;height:100vh"></span>',
      `<script>${viewerScript}</script>`,
      '</body>',
      '</html>',
      '',
    ].join('\n');
  }
  return cachedHtml;
}
