# AGENTS.md

## Project Overview

MCP (Model Context Protocol) server that lets AI assistants create and manipulate BPMN 2.0 workflow diagrams. Uses `bpmn-js` running headlessly via `jsdom` (delegated to `bpmn-to-image`) to produce valid BPMN XML and SVG output.

## BPMN File Editing Policy

**When working with `.bpmn` files, always use the BPMN MCP tools instead of editing BPMN XML directly.** The MCP tools ensure valid BPMN 2.0 structure, proper diagram layout coordinates, and semantic correctness that hand-editing XML cannot guarantee.

- **To modify an existing `.bpmn` file:** use `import_bpmn_xml` to load it, make changes with MCP tools, then `export_bpmn` and write the result back.
- **To create a new diagram:** use `create_bpmn_diagram`, build it with `add_bpmn_element` / `connect_bpmn_elements`, then `export_bpmn`.
- **Never** use `replace_string_in_file` or other text-editing tools on `.bpmn` XML.

## Tech Stack

- **Language:** TypeScript (ES2022, CommonJS)
- **Runtime:** Node.js ≥ 22
- **Key deps:** `@modelcontextprotocol/sdk`, `bpmn-js`, `bpmn-auto-layout` (from `github:datakurre/bpmn-auto-layout`), `bpmn-to-image` (from `github:datakurre/bpmn-to-image` — headless jsdom canvas, polyfills, SVG/PNG rendering), `camunda-bpmn-moddle`, `bpmnlint`, `bpmnlint-plugin-camunda-compat`, `@types/bpmn-moddle`
- **Test:** Vitest
- **Lint:** ESLint 9 + typescript-eslint 8
- **Dev env:** Nix (devenv) with devcontainer support

## BPMN-JS examples

- https://github.com/bpmn-io/bpmn-js-examples
- https://github.com/bpmn-io/diagram-js-examples
- https://forum.bpmn.io/search?q=

## Architecture

Modular `src/` layout, communicates over **stdio** using the MCP SDK. See [`docs/architecture.md`](docs/architecture.md) for a full dependency diagram and module boundary rules.

| File / Directory                | Responsibility                                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                  | Entry point — wires MCP server, transport, and tool modules                                                                                                                       |
| `src/module.ts`                 | Generic `ToolModule` interface for pluggable editor back-ends (BPMN, DMN, Forms, …)                                                                                               |
| `src/bpmn-module.ts`            | BPMN tool module — registers BPMN tools and dispatch with the generic server                                                                                                      |
| `src/types.ts`                  | Shared interfaces (`DiagramState`, `ToolResult`, tool arg types)                                                                                                                  |
| `src/bpmn-types.ts`             | TypeScript interfaces for bpmn-js services (`Modeling`, `ElementRegistry`, etc.)                                                                                                  |
| `src/constants.ts`              | Centralised magic numbers: element sizes, spacing, pool/lane sizing — single source of truth for all constants                                                                    |
| `src/auto-layout.ts`            | Bridge to the `bpmn-auto-layout` library — runs it and applies the generated DI to the modeler as one undoable command (full, scoped, or element-subset layout)                   |
| `src/auto-layout-input.ts`      | Prepares the XML handed to `bpmn-auto-layout`: boundary-event lane sync, element-subset extraction                                                                                |
| `src/diagram-manager.ts`        | In-memory `Map<string, DiagramState>` store, modeler creation helpers                                                                                                             |
| `src/tool-definitions.ts`       | Thin barrel collecting co-located `TOOL_DEFINITION` exports from handlers                                                                                                         |
| `src/handlers/index.ts`         | Handler barrel + `dispatchToolCall` router + unified TOOL_REGISTRY                                                                                                                |
| `src/handlers/helpers.ts`       | Shared utilities: `validateArgs`, `requireDiagram`, `requireElement`, `getVisibleElements`, `upsertExtensionElement`, `resolveOrCreateError`, etc.                                |
| `src/handlers/core/`            | Diagram lifecycle: create, delete, clone, list, summarize, import, export, validate, batch, history, diff, list-process-variables                                                 |
| `src/handlers/elements/`        | Element CRUD: add, connect, delete, move, duplicate, insert, replace, list, get-properties                                                                                        |
| `src/handlers/properties/`      | Property setters: set-properties, set-input-output, set-event-definition, set-form-data, set-loop-characteristics, set-script, set-camunda-listeners, set-call-activity-variables |
| `src/handlers/layout/`          | Layout & alignment: layout-diagram, align-elements, adjust-labels, label-utils                                                                                                    |
| `src/handlers/collaboration/`   | Collaboration: create-collaboration, create-lanes, assign-elements-to-lane, wrap-process-in-collaboration, manage-root-elements, handoff-to-lane                                  |
| `src/linter.ts`                 | Centralised bpmnlint integration: lint config, Linter instance, `lintDiagram()`, `appendLintFeedback()`                                                                           |
| `src/bpmnlint-types.ts`         | TypeScript type declarations for bpmnlint (`LintConfig`, `LintResults`, `FlatLintIssue`)                                                                                          |
| `src/bpmnlint-plugin-bpmn-mcp/` | Custom bpmnlint plugin with Camunda 7 (Operaton) specific rules                                                                                                                   |
| `src/persistence.ts`            | Optional file-backed diagram persistence — auto-save to `.bpmn` files, load on startup                                                                                            |

**Core pattern:**

1. `bpmn-to-image` provides the shared `jsdom` instance, browser API polyfills (SVG, CSS, structuredClone), and the headless `BpmnModeler` factory that let `bpmn-js` run headlessly.
2. Diagrams are stored in-memory in a `Map<string, DiagramState>` keyed by generated IDs.
3. **25 MCP tools** are exposed (see "Tool Naming" below; set `BPMN_MCP_TOOLS=core` for a 12-tool subset via the `tier` field on `TOOL_REGISTRY` entries — dispatch always accepts every tool regardless of tier), plus **5 resource templates** (diagram summary, lint, variables, XML, and an executable-Camunda-7 guide) and **3 modeling-style prompts** (`executable`, `executable-pool`, `collaboration`) that set the diagram-building context for the session.
4. Each tool handler manipulates the `bpmn-js` modeler API (`modeling`, `elementFactory`, `elementRegistry`) and returns JSON or raw XML/SVG.
5. `camunda-bpmn-moddle` is registered as a moddle extension, enabling Camunda-specific attributes (e.g. `camunda:assignee`, `camunda:class`, `camunda:formKey`) on elements.
6. Each handler file **co-locates** its MCP tool definition (`TOOL_DEFINITION`) alongside the handler function, preventing definition drift.
7. **bpmnlint** is integrated for BPMN validation. The `McpPluginResolver` wraps bpmnlint's `NodeResolver` to support both npm plugins (`bpmnlint-plugin-camunda-compat`) and the bundled custom plugin (`bpmnlint-plugin-bpmn-mcp`). Mutating tool handlers call `appendLintFeedback()` to append error-level lint issues to their response.
8. **Label adjustment** runs after layout and connection operations, using geometry-based scoring to position external labels away from connection paths.
9. **SVG image content** can be appended to every mutating tool response by creating a diagram with `includeImage: true`. When enabled, `appendLintFeedback()` calls `modeler.saveSVG()` → base64-encodes the SVG → appends an `ImageContent` item (`type: "image"`, `mimeType: "image/svg+xml"`, `annotations: { audience: ["user"] }`) to the response content array.

## Tool Naming Convention

**Every tool name includes `bpmn`** to avoid collisions with other MCPs.

- **Core structural tools:** `create_bpmn_diagram` (includes cloning via `cloneFrom`), `add_bpmn_element` (includes insert-into-flow via `flowId`, cross-lane handoff via `fromElementId`+`toLaneId`), `connect_bpmn_elements` (includes waypoint editing via `connectionId`+`waypoints`), `delete_bpmn_element`, `move_bpmn_element` (includes resize via `width`/`height`), `list_bpmn_elements`, `validate_bpmn_diagram`, `align_bpmn_elements` (includes distribute via `orientation`), `export_bpmn`, `import_bpmn_xml`
- **Property / extension tools:** `get_bpmn_element_properties`, `set_bpmn_element_properties` (includes element-type replacement via `elementType`, plus `inputOutput`/`formData`/`listeners`/`callActivityVariables`/`loop` sub-objects — see ADR-021), `set_bpmn_event_definition`
- **Collaboration tools:** `create_bpmn_participant` (includes wrapping an existing process via `wrapExisting`), `create_bpmn_lanes` (includes merging an existing collaboration via `mergeFrom`), `assign_bpmn_elements_to_lane`, `manage_bpmn_root_elements`, `analyze_bpmn_lanes` (modes: suggest, validate, pool-vs-lanes, redistribute)
- **History tools:** `bpmn_history`
- **Batch tools:** `batch_bpmn_operations`
- **Utility tools:** `delete_bpmn_diagram`, `list_bpmn_diagrams` (includes diagram summary via `diagramId`, diffing via `compareWith`), `list_bpmn_process_variables`, `layout_bpmn_diagram` (includes pool/lane autosizing via `autosizeOnly`), `add_bpmn_element_chain`
- **Internal-only handlers (not registered as MCP tools):** `handleCreateCollaboration`, `handleInsertElement`, `handleSplitParticipantIntoLanes`, `handleSummarizeDiagram`, `handleDuplicateElement`, `handleSetScript`, `handleAdjustLabels`, `handleSuggestLaneOrganization`, `handleValidateLaneOrganization`, `handleSuggestPoolVsLanes`, `handleHandoffToLane`, `handleReplaceElement`, `handleSetConnectionWaypoints`, `handleRedistributeElementsAcrossLanes`, `handleAutosizePoolsAndLanes`, `handleWrapProcessInCollaboration`, `handleConvertCollaborationToLanes`, `handleCloneDiagram`, `handleDiffDiagrams`
- **Hidden aliases (registered, dispatchable, excluded from `TOOL_DEFINITIONS`/`ListTools` — ADR-021):** `set_bpmn_input_output_mapping`, `set_bpmn_form_data`, `set_bpmn_camunda_listeners`, `set_bpmn_call_activity_variables`, `set_bpmn_loop_characteristics` — consolidated into `set_bpmn_element_properties`'s `inputOutput`/`formData`/`listeners`/`callActivityVariables`/`loop` sub-objects

## Build & Run

```bash
npm install
npm run build      # esbuild → single dist/index.js bundle
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm start          # node dist/index.js (stdio)
npm run watch      # esbuild --watch
npm test           # vitest run
```

`make` targets mirror npm scripts — run `make help` to list them.

**Bundling:** esbuild bundles all source + `@modelcontextprotocol/sdk` + `camunda-bpmn-moddle` into one CJS file. `bpmn-js`, `bpmn-auto-layout`, `bpmn-to-image`, `bpmnlint`, and `bpmnlint-plugin-camunda-compat` are externalised (remain in `node_modules`).

**Install from git:** `npm install github:datakurre/bpmn-js-mcp` works — `prepare` triggers `npm run build`.

Output goes to `dist/`. Entry point is `dist/index.js` (also declared as the `bpmn-js-mcp` bin).

## Testing

- **Framework:** Vitest (config in `vitest.config.ts`)
- **Location:** `test/handlers/<name>.test.ts` (per-handler), `test/tool-definitions.test.ts`, `test/diagram-manager.test.ts`, `test/linter.test.ts`
- **Shared helpers:** `test/helpers.ts` (`parseResult`, `createDiagram`, `addElement`, `clearDiagrams`)
- **Run:** `npm test` or `make test`

## Code Conventions

- Uses ES `import` throughout; esbuild converts to CJS for the bundle.
- `tsc` is used only for type-checking (`--noEmit`), esbuild for actual output.
- Tool responses use `{ content: [{ type: "text", text: ... }] }` MCP format.
- Tool definitions are co-located with their handler as `TOOL_DEFINITION` exports.
- Warnings/hints are appended to export outputs when elements appear disconnected.
- `clearDiagrams()` exposed for test teardown.
- Runtime argument validation via `validateArgs()` in every handler that has required params.
- Shared patterns (element filtering, extension element management, error resolution) are extracted into `helpers.ts` to avoid duplication.
- Mutating handlers call `appendLintFeedback()` from `src/linter.ts` to append bpmnlint error-level issues to their responses. Read-only handlers (`list-elements`, `get-properties`, `lint`) and `create-diagram` do not.
- `export_bpmn` runs an implicit lint gate: export is blocked when error-level issues exist, unless `skipLint: true` is passed. Tests that call `handleExportXml`/`handleExportSvg` on incomplete diagrams must pass `skipLint: true`.

## Architecture Decision Records

Individual ADRs are in [`agents/adrs/`](agents/adrs/):

- [ADR-001](agents/adrs/ADR-001-co-located-tool-definitions.md) — Co-located tool definitions
- [ADR-002](agents/adrs/ADR-002-merged-auto-layout.md) — Merged auto_layout into layout_diagram
- [ADR-004](agents/adrs/ADR-004-merged-export-tools.md) — Merged export_bpmn_xml and export_bpmn_svg
- [ADR-005](agents/adrs/ADR-005-canonical-loop-tool.md) — set_loop_characteristics is canonical
- [ADR-006](agents/adrs/ADR-006-bpmnlint-mcp-plugin-resolver.md) — bpmnlint via McpPluginResolver
- [ADR-007](agents/adrs/ADR-007-validate-delegates-to-bpmnlint.md) — validate delegates to bpmnlint
- [ADR-008](agents/adrs/ADR-008-lint-errors-only.md) — Implicit lint feedback errors only
- [ADR-009](agents/adrs/ADR-009-fresh-linter-per-call.md) — Fresh Linter per call
- [ADR-010](agents/adrs/ADR-010-export-lint-gate.md) — Implicit lint gate on export
- [ADR-011](agents/adrs/ADR-011-bottom-label-extra-spacing.md) — Extra bottom label spacing
- [ADR-012](agents/adrs/ADR-012-geometry-based-label-adjustment.md) — Geometry-based label adjustment
- [ADR-013](agents/adrs/ADR-013-element-id-naming.md) — 2-part element ID naming
- [ADR-015](agents/adrs/ADR-015-bpmn-in-tool-names.md) — All tool names include "bpmn"
- [ADR-018](agents/adrs/ADR-018-elk-removal-rebuild-only.md) — ELK removal — rebuild-only layout (superseded by ADR-020)
- [ADR-019](agents/adrs/ADR-019-tool-consolidation.md) — Tool consolidation
- [ADR-020](agents/adrs/ADR-020-bpmn-auto-layout-library.md) — Layout delegated to bpmn-auto-layout
- [ADR-021](agents/adrs/ADR-021-camunda-setter-consolidation.md) — Camunda setters consolidated into set_bpmn_element_properties
- [ADR-022](agents/adrs/ADR-022-bpmn-to-image-library.md) — Headless rendering delegated to bpmn-to-image

## Key Gotchas

- **Never write BPMN XML or structured files via terminal commands.** Using `cat > file << EOF` or similar heredoc patterns can corrupt XML through terminal line wrapping (e.g. `<bpmndi:BPMNEdge>` becoming `<bpmndi:BPMEdge>`). Always use `create_file` or `replace_string_in_file` tools which handle content atomically. For BPMN files specifically, always use the BPMN MCP tools (`export_bpmn` → write) rather than hand-editing XML.
- The headless jsdom canvas, SVG/CSS polyfills (`SVGMatrix`, `getBBox`, `getScreenCTM`, `transform`, `createSVGMatrix`, `createSVGTransform`), and the `bpmn-js` browser bundle's `eval`-loading are all owned by `bpmn-to-image` (`createHeadlessCanvas`/`getBpmnModeler`), not this repo. `src/diagram-manager.ts` builds on top of it via `createModeler({ robot: false })`.
- Diagram state is in-memory by default. Optional file-backed persistence can be enabled via `enablePersistence(dir)` from `src/persistence.ts`.
- The shared jsdom instance and `BpmnModeler` constructor (inside `bpmn-to-image`) are lazily initialized on first use and then reused.
- bpmnlint requires moddle root elements (not raw XML). Use `getDefinitionsFromModeler()` from `src/linter.ts` to extract the `bpmn:Definitions` element from a bpmn-js modeler.
- **Do not cache a bpmnlint `Linter` instance.** Some rules use closure state that accumulates across calls. `createLinter()` in `src/linter.ts` always creates a fresh instance.
- The `DEFAULT_LINT_CONFIG` extends `bpmnlint:recommended`, `plugin:camunda-compat/camunda-platform-7-24`, and `plugin:bpmn-mcp/recommended`. It downgrades `label-required` and `no-disconnected` to warnings (AI callers build diagrams incrementally), and disables `no-overlapping-elements` (false positives in headless mode).
- Custom bpmnlint rules live in `src/bpmnlint-plugin-bpmn-mcp/` and are registered as a proper bpmnlint plugin via `McpPluginResolver` in `src/linter.ts`. They can be referenced in config as `plugin:bpmn-mcp/recommended` or individually as `bpmn-mcp/rule-name`.
- Element IDs prefer short 2-part naming: `UserTask_EnterName`, `Flow_Done`. On collision, falls back to 3-part with random middle: `UserTask_a1b2c3d_EnterName`, `Flow_m4n5p6q_Done`. Unnamed elements use `StartEvent_x9y8z7w`. The random 7-char part ensures uniqueness for copy/paste across diagrams.
- Layout is delegated to `bpmn-auto-layout` (`github:datakurre/bpmn-auto-layout`); layout algorithm changes belong in that repository. `src/auto-layout.ts` applies the library's DI through `modeling` commands inside one compound command, so undo reverts a whole layout. Layout DI is keyed by BPMN (business object) ID, which can differ from the element registry ID — always look up via `businessObject.id`.
- bpmn-js ≥ 18.2x measures text with `canvas.measureText()`; jsdom has no canvas, so `bpmn-to-image`'s canvas-2d polyfill provides a `measureText` implementation. Without it every label measures 0px wide.
- Label direct-editing is disabled on headless modelers (`diagram-manager.ts`): an editing session opened by `autoPlace` would otherwise be completed mid-command and throw.
- bpmnlint has no rule to detect semantic gateway-type mismatches (e.g. using a parallel gateway to merge mutually exclusive paths). Such errors require manual review or domain-specific rules.
