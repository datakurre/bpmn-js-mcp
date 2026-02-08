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
- **Key deps:** `@modelcontextprotocol/sdk`, `bpmn-js`, `jsdom`, `camunda-bpmn-moddle`, `bpmnlint`, `bpmnlint-plugin-camunda-compat`, `@types/bpmn-moddle`
- **Test:** Vitest
- **Lint:** ESLint 9 + typescript-eslint 8
- **Dev env:** Nix (devenv) with devcontainer support

## BPMN-JS examples

- https://github.com/bpmn-io/bpmn-js-examples
- https://github.com/bpmn-io/diagram-js-examples
- https://forum.bpmn.io/search?q=

## Architecture

Modular `src/` layout, communicates over **stdio** using the MCP SDK.

| File / Directory                | Responsibility                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                  | Entry point — wires MCP server, transport, and request handlers                                                                                    |
| `src/types.ts`                  | Shared interfaces (`DiagramState`, `ToolResult`, tool arg types)                                                                                   |
| `src/bpmn-types.ts`             | TypeScript interfaces for bpmn-js services (`Modeling`, `ElementRegistry`, etc.)                                                                   |
| `src/constants.ts`              | Centralised magic numbers (`STANDARD_BPMN_GAP`, `ELEMENT_SIZES`)                                                                                   |
| `src/headless-canvas.ts`        | jsdom setup, SVG/CSS polyfills, lazy `BpmnModeler` init                                                                                            |
| `src/diagram-manager.ts`        | In-memory `Map<string, DiagramState>` store, modeler creation helpers                                                                              |
| `src/tool-definitions.ts`       | Thin barrel collecting co-located `TOOL_DEFINITION` exports from handlers                                                                          |
| `src/handlers/index.ts`         | Handler barrel + `dispatchToolCall` router with backward-compat aliases                                                                            |
| `src/handlers/helpers.ts`       | Shared utilities: `validateArgs`, `requireDiagram`, `requireElement`, `getVisibleElements`, `upsertExtensionElement`, `resolveOrCreateError`, etc. |
| `src/linter.ts`                 | Centralised bpmnlint integration: lint config, Linter instance, `lintDiagram()`, `appendLintFeedback()`                                            |
| `src/bpmnlint-types.ts`         | TypeScript type declarations for bpmnlint (`LintConfig`, `LintResults`, `FlatLintIssue`)                                                           |
| `src/bpmnlint-plugin-bpmn-mcp/` | Custom bpmnlint plugin with Camunda 7 (Operaton) specific rules                                                                                    |
| `src/handlers/label-utils.ts`   | Pure geometry helpers for label-overlap detection (rect intersection, scoring)                                                                     |
| `src/handlers/adjust-labels.ts` | Post-processing label adjustment to avoid connection/label overlaps                                                                                |
| `src/handlers/<name>.ts`        | One handler file per tool — exports `handleXxx` + `TOOL_DEFINITION`                                                                                |

**Core pattern:**

1. A shared `jsdom` instance polyfills browser APIs (SVG, CSS, structuredClone) so `bpmn-js` can run headlessly.
2. Diagrams are stored in-memory in a `Map<string, DiagramState>` keyed by generated IDs.
3. **24 MCP tools** are exposed (see "Tool Naming" below).
4. Each tool handler manipulates the `bpmn-js` modeler API (`modeling`, `elementFactory`, `elementRegistry`) and returns JSON or raw XML/SVG.
5. `camunda-bpmn-moddle` is registered as a moddle extension, enabling Camunda-specific attributes (e.g. `camunda:assignee`, `camunda:class`, `camunda:formKey`) on elements.
6. Each handler file **co-locates** its MCP tool definition (`TOOL_DEFINITION`) alongside the handler function, preventing definition drift.
7. **bpmnlint** is integrated for BPMN validation. The `McpPluginResolver` wraps bpmnlint's `NodeResolver` to support both npm plugins (`bpmnlint-plugin-camunda-compat`) and the bundled custom plugin (`bpmnlint-plugin-bpmn-mcp`). Mutating tool handlers call `appendLintFeedback()` to append error-level lint issues to their response.
8. **Label adjustment** runs after layout and connection operations, using geometry-based scoring to position external labels away from connection paths.

## Tool Naming Convention

- **Core structural BPMN tools** use a `bpmn_` infix: `create_bpmn_diagram`, `add_bpmn_element`, `connect_bpmn_elements`, `delete_bpmn_element`, `move_bpmn_element`, `list_bpmn_elements`, `validate_bpmn_diagram`, `align_bpmn_elements`, `distribute_bpmn_elements`, `export_bpmn`, `import_bpmn_xml`
- **Camunda-specific tools** use `set_` / descriptive names: `set_element_properties`, `set_input_output_mapping`, `set_event_definition`, `set_form_data`, `set_camunda_error_event_definition`, `set_loop_characteristics`
- **Utility tools** use flat names: `delete_diagram`, `list_diagrams`, `clone_diagram`, `layout_diagram`, `get_element_properties`, `lint_bpmn_diagram`, `adjust_labels`
- **Backward-compat aliases** in the dispatch map: `auto_layout` → `layout_diagram`, `export_bpmn_xml` → `export_bpmn(format: "xml")`, `export_bpmn_svg` → `export_bpmn(format: "svg")`

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

**Bundling:** esbuild bundles all source + `@modelcontextprotocol/sdk` + `camunda-bpmn-moddle` into one CJS file. `jsdom` and `bpmn-js` are externalised (remain in `node_modules`).

**Install from git:** `npm install github:dattmavis/BPMN-MCP` works — `prepare` triggers `npm run build`.

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
- Mutating handlers call `appendLintFeedback()` from `src/linter.ts` to append bpmnlint error-level issues to their responses. Read-only handlers (`list-elements`, `get-properties`, `export`, `lint`) and `create-diagram` do not.

## Architecture Decision Records

### Why tool definitions are co-located with handlers

Each handler file exports both `handleXxx` and `TOOL_DEFINITION`. This keeps the MCP schema in sync with the implementation, prevents drift, and makes it easy to see exactly what a tool accepts without switching files. `tool-definitions.ts` is a thin barrel that collects them.

### Why `auto_layout` was merged into `layout_diagram`

`auto_layout` was a strict subset of `layout_diagram` (which called it internally). Having both confused AI callers with a needless choice. A backward-compat alias preserves existing callers.

### Why `export_bpmn_xml` and `export_bpmn_svg` were merged into `export_bpmn`

Both did the same thing with different output formats. A single tool with `format: "xml" | "svg"` is cleaner. Backward-compat aliases in the dispatch map preserve existing callers.

### Why `set_loop_characteristics` is the canonical loop tool

`set_element_properties` had a `loopCharacteristics` passthrough that duplicated the dedicated tool. The dedicated tool has a better schema with typed params. The passthrough was removed.

### Why bpmnlint is integrated via McpPluginResolver

bpmnlint uses dynamic `require()` to resolve rules and configs at runtime. Rather than fighting esbuild bundling with a `StaticResolver`, bpmnlint and `bpmnlint-plugin-camunda-compat` are marked `external` in esbuild (same as `bpmn-js` and `jsdom`), letting `NodeResolver` work naturally from `node_modules`. The `McpPluginResolver` wraps `NodeResolver` and intercepts requests for our bundled `bpmnlint-plugin-bpmn-mcp` plugin, serving its rules and configs from ES imports within the bundle.

### Why `validate_bpmn_diagram` fully delegates to bpmnlint

The hand-written checks in the original `validate` handler overlapped significantly with bpmnlint rules (`start-event-required`, `end-event-required`, `no-disconnected`, `label-required`). Delegating to bpmnlint eliminates maintenance burden while adding 27+ additional checks. Camunda-specific checks (`camunda-topic-without-external-type`, `gateway-missing-default`) are now registered as proper bpmnlint rules in `bpmnlint-plugin-bpmn-mcp` and resolved via `McpPluginResolver`, so the validate handler no longer needs manual check functions.

### Why implicit lint feedback only includes errors

`appendLintFeedback()` filters to error-severity issues only. Including warnings would make every response verbose during incremental diagram construction. The explicit `lint_bpmn_diagram` tool returns all severities for callers who want the full picture.

### Why label adjustment is geometry-based (not behavior-based)

bpmn-js has `AdaptiveLabelPositioningBehavior` but it only considers connection direction quadrants, not actual bounding-box intersection. Our approach scores 4 candidate positions (top/bottom/left/right) against all connection segments and other labels using Cohen-Sutherland intersection tests, picking the position with the lowest collision score.

## Key Gotchas

- The `bpmn-js` browser bundle is loaded via `eval` inside jsdom; polyfills for `SVGMatrix`, `getBBox`, `getScreenCTM`, `transform`, `createSVGMatrix`, and `createSVGTransform` are manually defined in `headless-canvas.ts`.
- Diagram state is ephemeral (in-memory only); no persistence across server restarts.
- The `jsdom` instance and `BpmnModeler` constructor are lazily initialized on first use and then reused.
- bpmnlint requires moddle root elements (not raw XML). Use `getDefinitionsFromModeler()` from `src/linter.ts` to extract the `bpmn:Definitions` element from a bpmn-js modeler.
- The `DEFAULT_LINT_CONFIG` extends `bpmnlint:recommended`, `plugin:camunda-compat/camunda-platform-7-24`, and `plugin:bpmn-mcp/recommended`. It downgrades `label-required` and `no-disconnected` to warnings (AI callers build diagrams incrementally), and disables `no-overlapping-elements` (false positives in headless mode).
- Custom bpmnlint rules live in `src/bpmnlint-plugin-bpmn-mcp/` and are registered as a proper bpmnlint plugin via `McpPluginResolver` in `src/linter.ts`. They can be referenced in config as `plugin:bpmn-mcp/recommended` or individually as `bpmn-mcp/rule-name`.
