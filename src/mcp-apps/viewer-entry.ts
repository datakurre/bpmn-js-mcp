/**
 * Browser-side MCP Apps View for the diagram viewer (issue #11 / ADR-025).
 *
 * Bundled by esbuild into a standalone IIFE (see esbuild.config.mjs's
 * `mcp-apps-viewer-bundle` target) and inlined into the `ui://bpmn-diagram-viewer`
 * resource served by `src/mcp-apps/resource.ts`, alongside bpmn-to-image's own
 * `renderInteractiveAssetsHtml()` bundle (bpmn-js NavigatedViewer +
 * token-simulation), which exposes a `window.TokenSimulation(id, xmlBase64)`
 * init function this file calls into.
 *
 * Protocol: implements the MCP Apps View side (`@modelcontextprotocol/ext-apps`)
 * — connects to the host via `postMessage`, then re-renders the diagram each
 * time a tool call result arrives (`ontoolresult`) that carries an embedded
 * `application/xml` resource content item (see `appendMcpAppContent()` in
 * `src/linter.ts` on the server side). That item is only present when the
 * host advertised MCP Apps support and the diagram stays under
 * `LARGE_XML_CHARS`. The server only points tools at this view for such
 * hosts, so a missing item means the diagram was too large to embed.
 *
 * The pure data-extraction logic below (`extractDiagramXml`,
 * `base64EncodeUtf8`) has no DOM dependency and is unit-tested directly in
 * `test/mcp-apps-viewer.test.ts`; only the thin DOM-wiring at the bottom of
 * this file is exercised by the earlier browser-bundle spike instead.
 */

import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

declare global {
  interface Window {
    /** Exposed by bpmn-to-image's token-simulation-viewer-bundle.js. */
    TokenSimulation?: (id: string, xmlBase64: string, background?: string) => void;
  }
}

export const CONTAINER_ID = 'bpmn-app-view';

/**
 * Find the embedded diagram XML in a `ui/notifications/tool-result`
 * payload's content array, or `undefined` if none is present (diagram past
 * `LARGE_XML_CHARS` — see `appendMcpAppContent()`).
 */
export function extractDiagramXml(content: unknown[] | undefined): string | undefined {
  const xmlItem = (content ?? []).find(
    (item): item is { type: 'resource'; resource: { mimeType?: string; text?: string } } =>
      typeof item === 'object' &&
      item !== null &&
      (item as { type?: string }).type === 'resource' &&
      (item as { resource?: { mimeType?: string } }).resource?.mimeType === 'application/xml'
  );
  return xmlItem?.resource.text;
}

/** UTF-8-safe `btoa` — plain `btoa` throws on any non-Latin1 character. */
export function base64EncodeUtf8(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

/* istanbul ignore next -- thin DOM glue, covered by the manual browser-bundle spike, not unit tests */
function showMessage(message: string): void {
  const el = document.getElementById(CONTAINER_ID);
  if (el) el.textContent = message;
}

/* istanbul ignore next -- thin DOM glue, covered by the manual browser-bundle spike, not unit tests */
function main(): void {
  const app = new App({ name: 'bpmn-js-mcp-viewer', version: '1.0.0' }, {});

  app.ontoolresult = (result) => {
    const xml = extractDiagramXml((result as { content?: unknown[] }).content);
    if (!xml) {
      showMessage('This diagram is too large to preview inline. Use export_bpmn instead.');
      return;
    }
    if (typeof window.TokenSimulation !== 'function') {
      showMessage('Diagram viewer failed to load.');
      return;
    }
    window.TokenSimulation(CONTAINER_ID, base64EncodeUtf8(xml));
  };

  showMessage('Waiting for diagram…');

  app.connect(new PostMessageTransport(window.parent, window.parent)).catch((error: unknown) => {
    showMessage(
      `Failed to connect to host: ${error instanceof Error ? error.message : String(error)}`
    );
  });
}

/* istanbul ignore next -- only false when imported for unit-testing the pure functions above (Node, no DOM) */
if (typeof document !== 'undefined') main();
