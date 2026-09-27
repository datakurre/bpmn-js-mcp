# ADR-025: MCP Apps Diagram Viewer

## Status

Accepted

## Context

Issue #11 asked for an interactive bpmn-js diagram view rendered inline in
the chat, using the MCP Apps extension
(`_meta.ui.resourceUri` on a tool definition, pointing hosts at a `ui://`
HTML resource that renders in a sandboxed iframe and talks back to the tool
call over `postMessage`-based JSON-RPC).

The reference package, `@modelcontextprotocol/ext-apps`, ships two things:

1. Server-side helpers (`registerAppTool`, etc.) that only work with the
   new `@modelcontextprotocol/server`/`client`/`core` 2.x package family —
   incompatible with this project's `@modelcontextprotocol/sdk` 1.x, and a
   full migration to the 2.x family is a large, unrelated, high-risk change
   out of scope for this issue.
2. Browser-side helpers (`App`, `PostMessageTransport`) that implement the
   View side of the protocol and have no dependency on which server SDK
   produced the tool result.

Reading the package's own type declarations (`constants.d.ts`,
`spec.types.d.ts`) showed the wire protocol itself is plain JSON: a tool
definition's `_meta.ui.resourceUri` names a resource with mimeType
`text/html;profile=mcp-app`; the host reads that resource once, renders it
in an iframe, and after every call to that tool sends the View a
`ui/notifications/tool-result` notification whose `params` is the _entire_
`CallToolResult` (content + structuredContent) the server already returned.
This — not an app-initiated resource read back to the server — is how the
View gets the diagram to draw, sidestepping the optional
`hostCapabilities.serverResources` capability entirely.

That reframes the problem: no server-side SDK migration is needed. Only
plain fields on the existing SDK's tool definitions and resources, plus a
small, self-contained browser bundle for the View, is required.

## Decision

1. **Wire the spec directly on the existing SDK**, without
   `@modelcontextprotocol/ext-apps`'s server helpers:
   - `src/handlers/index.ts`'s `withMcpAppsMeta()` adds
     `_meta: { ui: { resourceUri: 'ui://bpmn-diagram-viewer' } }` to every
     mutating tool that leaves a diagram in place to view, in the ListTools
     payload for MCP Apps hosts only (see Addendum 3). Read-only tools
     (`export_bpmn`, `list_bpmn_diagrams`, `validate_bpmn_diagram`,
     `list_bpmn_elements`, `get_bpmn_element_properties`,
     `list_bpmn_process_variables`) and `delete_bpmn_diagram` (nothing left
     to view) are excluded via `MCP_APP_VIEW_EXCLUDED_TOOLS`.
   - `src/mcp-apps/resource.ts` serves `ui://bpmn-diagram-viewer` as a
     `text/html;profile=mcp-app` resource, wired into `src/resources.ts`
     alongside the existing static resources.
2. **Only the browser-side `App`/`PostMessageTransport` classes from
   `@modelcontextprotocol/ext-apps` are used at runtime**, inside
   `src/mcp-apps/viewer-entry.ts`. This file is bundled separately by
   esbuild into a standalone IIFE (`dist/mcp-apps-viewer-bundle.js`,
   `platform: 'browser'`, no `external`) and inlined as a `<script>` tag
   into the resource's HTML — it never touches the Node server bundle or
   its dependency graph. `@modelcontextprotocol/ext-apps`,
   `@modelcontextprotocol/client`, and `@modelcontextprotocol/core` are
   devDependencies only, needed at build/test time, not at server runtime.
3. **The View gets diagram data from `ui/notifications/tool-result`, not a
   resource read.** `app.ontoolresult` extracts an `application/xml`
   resource content item from the call result and hands it to
   `bpmn-to-image`'s existing `renderInteractiveAssetsHtml()` bundle (the
   same NavigatedViewer + token-simulation bundle already used for
   `export_bpmn`'s interactive HTML output), via its
   `window.TokenSimulation(id, xmlBase64)` entry point. No new bpmn-js
   viewer was written.
4. **The diagram XML is embedded as an opt-in, `audience: ['user']`
   resource content item**, not via `structuredContent`. Putting the XML in
   `structuredContent` would put it in the model's context per normal MCP
   conventions (defeating ADR-023's point). Instead
   `appendMcpAppContent()` (`src/linter.ts`) appends a
   `{ type: 'resource', resource: { uri, mimeType: 'application/xml', text }, annotations: { audience: ['user'] } }`
   item — the same convention already used for PNG/SVG image attachments —
   so the content reaches user-facing surfaces (including this View)
   without inflating what the model sees.
5. **Enabled per host, not per diagram.** The viewer and the embedded XML
   are only offered to hosts that advertise MCP Apps support (Addendum 3);
   every other client sees exactly the pre-ADR response shape. (The first
   version used an opt-in `includeAppView` flag on `create_bpmn_diagram`,
   removed in Addendum 3.) Embedding is skipped past `LARGE_XML_CHARS` (the
   same threshold ADR-023 introduced), same as the existing image-size
   gate, with the View showing a "too large to preview inline, use
   export_bpmn instead" message in that case.
6. **Dual build/typecheck setup**, since this is the first source file in
   `src/` that runs in a browser DOM rather than jsdom-polyfilled Node:
   - `tsconfig.json` excludes `src/mcp-apps/viewer-entry.ts`;
     `tsconfig.mcp-apps.json` extends it, adds `"DOM"` to `lib`, and
     includes only that file. `npm run typecheck` runs both.
   - `esbuild.config.mjs` gains a second build target
     (`mcp-apps-viewer-bundle`, `platform: 'browser'`, `format: 'iife'`)
     alongside the existing Node/CJS server bundle.
   - The pure logic in `viewer-entry.ts` (`extractDiagramXml`,
     `base64EncodeUtf8`) is factored out from the DOM-touching glue
     (`showMessage`, `main`, the `postMessage` handshake) so it can be
     unit-tested directly in plain-Node Vitest (`test/mcp-apps-viewer.test.ts`)
     without needing jsdom at all. The `main()` auto-run is guarded by
     `if (typeof document !== 'undefined')` so importing the module for
     tests doesn't execute the DOM-dependent path.

## Addendum: PR review (2026-09-27)

Code review on the implementing PR (datakurre/bpmn-js-mcp#24) surfaced a real
bug and a design suggestion, both worth recording here.

1. **Bug: `findViewerBundle()` failed under the actual built server.**
   `src/mcp-apps/resource.ts` resolved `dist/mcp-apps-viewer-bundle.js`
   relative to `__dirname`, with candidates tuned for running the file from
   its own source location (`src/mcp-apps/`, as vitest does). esbuild
   bundles this file straight into `dist/index.js`, so at runtime
   `__dirname` is `dist/` itself — one directory shallower than either
   candidate assumed — and both missed. Fixed by adding
   `path.resolve(__dirname, 'mcp-apps-viewer-bundle.js')` (the correct path
   when running from the bundled `dist/index.js`) as the first candidate,
   keeping the other two for the vitest/source case. A source-level test
   couldn't have caught this, since it never runs from `__dirname === dist/`;
   `test/mcp-apps-built-server.test.ts` now spawns the actual built
   `dist/index.js` over stdio with the real SDK client and reads the
   resource through it, so this class of bundling mismatch is covered going
   forward.
2. **Suggestion: replace embedded XML with a `resource_link` +
   `app.readServerResource()`, dropping `includeAppView`/`LARGE_XML_CHARS`
   entirely.** Considered and declined, for the same reason `readServerResource`
   was ruled out in the original design (Context, above):
   it depends on the optional `hostCapabilities.serverResources` capability,
   which is not guaranteed present. The chosen design deliberately depends
   only on `ui/notifications/tool-result`'s full-payload delivery, which the
   spec requires unconditionally, so it works on every compliant host, not
   only ones that opted into resource reads. Kept instead: the misleading
   fallback message (`"too large to preview"` regardless of the actual
   reason) was fixed to name both possible causes —
   `includeAppView` not set, or the diagram past `LARGE_XML_CHARS` — since
   that part of the critique was a real bug in the message text,
   independent of the design question.

3. **Follow-up: the viewer was advertised to every host, but only fed for
   `includeAppView` diagrams.** `_meta.ui.resourceUri` was on every mutating
   tool unconditionally while `includeAppView` defaulted to `false`, so an
   MCP Apps host opened the View after every mutating call and it had
   nothing to show. Fixed without depending on optional host capabilities:
   hosts that support MCP Apps say so in `initialize`, under
   `capabilities.extensions['io.modelcontextprotocol/ui']` (optionally with
   the `mimeTypes` they render). `src/mcp-apps/host-support.ts` detects that
   after `initialize` (`server.oninitialized` in `src/index.ts`); only then
   does ListTools carry the `_meta.ui` field (`withMcpAppsMeta()`) and do
   tool results embed the XML. `includeAppView` was removed. This needed
   `@modelcontextprotocol/sdk` ≥ 1.30: earlier 1.x releases dropped the
   `extensions` capability while parsing `initialize`. The server talks to
   one client over stdio, so a process-wide flag is sufficient.
   `test/mcp-apps-built-server.test.ts` checks both kinds of client against
   the built server.

## Consequences

- No migration off `@modelcontextprotocol/sdk` 1.x was needed; the only
  server dependency change is the bump to 1.30.1 (Addendum 3).
- Hosts that understand MCP Apps can render an interactive, pannable,
  zoomable bpmn-js diagram inline after any mutating tool call; other
  clients never see the `_meta` field or the embedded XML, so this is fully
  backwards compatible.
- **Known gap, disclosed rather than papered over**: full bidirectional
  protocol behavior (host connects to the View, View receives the live
  `ui/notifications/tool-result` and renders) is not verified by an
  automated end-to-end test in this repo. jsdom does not correctly
  populate `MessageEvent.source` for genuine cross-window
  (`iframe.contentWindow` ↔ parent) `postMessage`, which makes a faithful
  simulated host+iframe round trip infeasible in this test environment.
  What _is_ verified: the pure extraction/encoding logic (unit tests), that
  the bundle builds and runs correctly and produces the exact spec-shaped
  outbound handshake message (a manual browser-bundle spike), and that the
  code follows `@modelcontextprotocol/ext-apps`'s documented usage pattern
  exactly. Real host compatibility (Claude.ai, Claude Desktop, or any other
  MCP Apps host) should still be checked against that host's own client
  support matrix before relying on this in production, as the original
  issue itself anticipated.
- A future tool that leaves a diagram viewable should add itself to (or be
  excluded from, if read-only) the `_meta.ui.resourceUri` wiring in
  `computeToolDefinitions()` — there's no per-tool opt-in needed beyond
  that one list.
