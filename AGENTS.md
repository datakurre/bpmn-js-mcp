# AGENTS.md

## Project Overview

MCP (Model Context Protocol) server that lets AI assistants create and manipulate BPMN 2.0 workflow diagrams. Uses `bpmn-js` running headlessly via `jsdom` to produce valid BPMN XML and SVG output.

## BPMN File Editing Policy

**When working with `.bpmn` files, always use the BPMN MCP tools instead of editing BPMN XML directly.** The MCP tools ensure valid BPMN 2.0 structure, proper diagram layout coordinates, and semantic correctness that hand-editing XML cannot guarantee.

- **To modify an existing `.bpmn` file:** use `import_bpmn_xml` to load it, make changes with MCP tools, then `export_bpmn` and write the result back.
- **To create a new diagram:** use `create_bpmn_diagram`, build it with `add_bpmn_element` / `connect_bpmn_elements`, then `export_bpmn`.
- **Never** use `replace_string_in_file` or other text-editing tools on `.bpmn` XML.

## Tech Stack

- **Language:** TypeScript (ES2022, CommonJS)
- **Runtime:** Node.js ≥ 16
- **Key deps:** `@modelcontextprotocol/sdk`, `bpmn-js`, `jsdom`, `camunda-bpmn-moddle`, `elkjs`, `bpmnlint`, `bpmnlint-plugin-camunda-compat`, `@types/bpmn-moddle`
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
| `src/constants.ts`              | Centralised magic numbers (`STANDARD_BPMN_GAP`, `ELEMENT_SIZES`)                                                                                                                  |
| `src/headless-canvas.ts`        | jsdom setup, lazy `BpmnModeler` init                                                                                                                                              |
| `src/headless-polyfills.ts`     | SVG/CSS polyfills for headless bpmn-js (SVGMatrix, getBBox, transform with DOM sync, etc.)                                                                                        |
| `src/elk/`                      | ELK-based layout engine — Sugiyama layered algorithm via `elkjs` for automatic diagram arrangement, plus post-ELK grid snap, overlap resolution, and channel routing              |
| `src/diagram-manager.ts`        | In-memory `Map<string, DiagramState>` store, modeler creation helpers                                                                                                             |
| `src/tool-definitions.ts`       | Thin barrel collecting co-located `TOOL_DEFINITION` exports from handlers                                                                                                         |
| `src/handlers/index.ts`         | Handler barrel + `dispatchToolCall` router + unified TOOL_REGISTRY                                                                                                                |
| `src/handlers/helpers.ts`       | Shared utilities: `validateArgs`, `requireDiagram`, `requireElement`, `getVisibleElements`, `upsertExtensionElement`, `resolveOrCreateError`, etc.                                |
| `src/handlers/core/`            | Diagram lifecycle: create, delete, clone, list, summarize, import, export, validate, batch, history, diff, list-process-variables                                                 |
| `src/handlers/elements/`        | Element CRUD: add, connect, delete, move, duplicate, insert, replace, list, get-properties                                                                                        |
| `src/handlers/properties/`      | Property setters: set-properties, set-input-output, set-event-definition, set-form-data, set-loop-characteristics, set-script, set-camunda-listeners, set-call-activity-variables |
| `src/handlers/layout/`          | Layout & alignment: layout-diagram, align-elements, adjust-labels, label-utils                                                                                                    |
| `src/handlers/collaboration/`   | Collaboration: create-collaboration, manage-root-elements                                                                                                                         |
| `src/linter.ts`                 | Centralised bpmnlint integration: lint config, Linter instance, `lintDiagram()`, `appendLintFeedback()`                                                                           |
| `src/bpmnlint-types.ts`         | TypeScript type declarations for bpmnlint (`LintConfig`, `LintResults`, `FlatLintIssue`)                                                                                          |
| `src/bpmnlint-plugin-bpmn-mcp/` | Custom bpmnlint plugin with Camunda 7 (Operaton) specific rules                                                                                                                   |
| `src/persistence.ts`            | Optional file-backed diagram persistence — auto-save to `.bpmn` files, load on startup                                                                                            |

**Core pattern:**

1. A shared `jsdom` instance polyfills browser APIs (SVG, CSS, structuredClone) so `bpmn-js` can run headlessly.
2. Diagrams are stored in-memory in a `Map<string, DiagramState>` keyed by generated IDs.
3. **34 MCP tools** are exposed (see "Tool Naming" below), plus **5 resource templates** (diagram summary, lint, variables, XML, and an executable-Camunda-7 guide) and **6 prompt workflows** (create-executable-process, convert-to-collaboration, add-sla-timer-pattern, add-approval-pattern, add-error-handling-pattern, add-parallel-tasks-pattern).
4. Each tool handler manipulates the `bpmn-js` modeler API (`modeling`, `elementFactory`, `elementRegistry`) and returns JSON or raw XML/SVG.
5. `camunda-bpmn-moddle` is registered as a moddle extension, enabling Camunda-specific attributes (e.g. `camunda:assignee`, `camunda:class`, `camunda:formKey`) on elements.
6. Each handler file **co-locates** its MCP tool definition (`TOOL_DEFINITION`) alongside the handler function, preventing definition drift.
7. **bpmnlint** is integrated for BPMN validation. The `McpPluginResolver` wraps bpmnlint's `NodeResolver` to support both npm plugins (`bpmnlint-plugin-camunda-compat`) and the bundled custom plugin (`bpmnlint-plugin-bpmn-mcp`). Mutating tool handlers call `appendLintFeedback()` to append error-level lint issues to their response.
8. **Label adjustment** runs after layout and connection operations, using geometry-based scoring to position external labels away from connection paths.

## Tool Naming Convention

**Every tool name includes `bpmn`** to avoid collisions with other MCPs.

- **Core structural tools:** `create_bpmn_diagram`, `add_bpmn_element` (includes insert-into-flow via `flowId`), `insert_bpmn_element`, `connect_bpmn_elements`, `delete_bpmn_element`, `move_bpmn_element` (includes resize via `width`/`height`), `replace_bpmn_element`, `duplicate_bpmn_element`, `list_bpmn_elements`, `validate_bpmn_diagram`, `align_bpmn_elements` (includes distribute via `orientation`), `export_bpmn`, `import_bpmn_xml`
- **Property / extension tools:** `get_bpmn_element_properties`, `set_bpmn_element_properties`, `set_bpmn_input_output_mapping`, `set_bpmn_event_definition`, `set_bpmn_form_data`, `set_bpmn_camunda_listeners` (includes error definitions), `set_bpmn_loop_characteristics`, `set_bpmn_script`, `set_bpmn_call_activity_variables`
- **Collaboration & data tools:** `create_bpmn_collaboration`, `manage_bpmn_root_elements`
- **History tools:** `bpmn_history`, `diff_bpmn_diagrams`
- **Batch tools:** `batch_bpmn_operations`
- **Utility tools:** `delete_bpmn_diagram`, `list_bpmn_diagrams` (includes diagram summary via `diagramId`), `summarize_bpmn_diagram`, `list_bpmn_process_variables`, `clone_bpmn_diagram`, `layout_bpmn_diagram`, `adjust_bpmn_labels`

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

**Bundling:** esbuild bundles all source + `@modelcontextprotocol/sdk` + `camunda-bpmn-moddle` into one CJS file. `jsdom`, `bpmn-js`, `elkjs`, `bpmn-auto-layout`, `bpmnlint`, and `bpmnlint-plugin-camunda-compat` are externalised (remain in `node_modules`).

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
- [ADR-003](agents/adrs/ADR-003-elkjs-over-bpmn-auto-layout.md) — elkjs instead of bpmn-auto-layout
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
- [ADR-014](agents/adrs/ADR-014-post-elk-grid-snapping.md) — Post-ELK grid snapping
- [ADR-015](agents/adrs/ADR-015-bpmn-in-tool-names.md) — All tool names include "bpmn"

## Key Gotchas

- **Never write BPMN XML or structured files via terminal commands.** Using `cat > file << EOF` or similar heredoc patterns can corrupt XML through terminal line wrapping (e.g. `<bpmndi:BPMNEdge>` becoming `<bpmndi:BPMEdge>`). Always use `create_file` or `replace_string_in_file` tools which handle content atomically. For BPMN files specifically, always use the BPMN MCP tools (`export_bpmn` → write) rather than hand-editing XML.
- The `bpmn-js` browser bundle is loaded via `eval` inside jsdom; polyfills for `SVGMatrix`, `getBBox`, `getScreenCTM`, `transform`, `createSVGMatrix`, and `createSVGTransform` are manually defined in `headless-canvas.ts`.
- Diagram state is in-memory by default. Optional file-backed persistence can be enabled via `enablePersistence(dir)` from `src/persistence.ts`.
- The `jsdom` instance and `BpmnModeler` constructor are lazily initialized on first use and then reused.
- bpmnlint requires moddle root elements (not raw XML). Use `getDefinitionsFromModeler()` from `src/linter.ts` to extract the `bpmn:Definitions` element from a bpmn-js modeler.
- **Do not cache a bpmnlint `Linter` instance.** Some rules use closure state that accumulates across calls. `createLinter()` in `src/linter.ts` always creates a fresh instance.
- The `DEFAULT_LINT_CONFIG` extends `bpmnlint:recommended`, `plugin:camunda-compat/camunda-platform-7-24`, and `plugin:bpmn-mcp/recommended`. It downgrades `label-required` and `no-disconnected` to warnings (AI callers build diagrams incrementally), and disables `no-overlapping-elements` (false positives in headless mode).
- Custom bpmnlint rules live in `src/bpmnlint-plugin-bpmn-mcp/` and are registered as a proper bpmnlint plugin via `McpPluginResolver` in `src/linter.ts`. They can be referenced in config as `plugin:bpmn-mcp/recommended` or individually as `bpmn-mcp/rule-name`.
- Element IDs prefer short 2-part naming: `UserTask_EnterName`, `Flow_Done`. On collision, falls back to 3-part with random middle: `UserTask_a1b2c3d_EnterName`, `Flow_m4n5p6q_Done`. Unnamed elements use `StartEvent_x9y8z7w`. The random 7-char part ensures uniqueness for copy/paste across diagrams.
- `elkjs` is dynamically imported and externalized in esbuild (same as `bpmn-js`). It runs synchronously in the headless Node.js/jsdom environment (no web workers). The ELK graph is built from `elementRegistry.getAll()`, boundary events are excluded (they follow their host automatically via `modeling.moveElements`).
- bpmnlint has no rule to detect semantic gateway-type mismatches (e.g. using a parallel gateway to merge mutually exclusive paths). Such errors require manual review or domain-specific rules.
