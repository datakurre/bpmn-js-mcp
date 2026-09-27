/**
 * Whether the connected host renders MCP Apps (issue #11 / ADR-025).
 *
 * Hosts that support MCP Apps advertise it during `initialize` under
 * `capabilities.extensions['io.modelcontextprotocol/ui']`, optionally listing
 * the UI resource MIME types they render.  The server only advertises the
 * `ui://bpmn-diagram-viewer` view on its tools, and only embeds diagram XML
 * in tool results, for such hosts — other clients see neither.
 *
 * The server talks to exactly one client over stdio, so a process-wide flag
 * set once after `initialize` is sufficient.
 */

import { APP_VIEWER_MIME_TYPE } from './resource';

/** Extension identifier hosts use to advertise MCP Apps support. */
export const MCP_APPS_EXTENSION_ID = 'io.modelcontextprotocol/ui';

let hostSupportsMcpApps = false;

/**
 * Detect MCP Apps support from the client capabilities sent in `initialize`.
 * A host that lists `mimeTypes` must include the viewer's MIME type; a host
 * that advertises the extension without `mimeTypes` is assumed to accept it.
 */
export function detectMcpAppsSupport(clientCapabilities: unknown): boolean {
  const extensions = (clientCapabilities as { extensions?: Record<string, unknown> } | undefined)
    ?.extensions;
  const ui = extensions?.[MCP_APPS_EXTENSION_ID] as { mimeTypes?: unknown } | undefined;
  if (!ui || typeof ui !== 'object') return false;
  if (!Array.isArray(ui.mimeTypes)) return true;
  return ui.mimeTypes.includes(APP_VIEWER_MIME_TYPE);
}

/** Record whether the connected host renders MCP Apps. */
export function setMcpAppsHostSupported(supported: boolean): void {
  hostSupportsMcpApps = supported;
}

/** True when the connected host advertised MCP Apps support. */
export function isMcpAppsHostSupported(): boolean {
  return hostSupportsMcpApps;
}
