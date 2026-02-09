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

Modular `src/` layout, communicates over **stdio** using the MCP SDK.

| File / Directory                | Responsibility                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                  | Entry point — wires MCP server, transport, and request handlers                                                                                    |
| `src/types.ts`                  | Shared interfaces (`DiagramState`, `ToolResult`, tool arg types)                                                                                   |
| `src/bpmn-types.ts`             | TypeScript interfaces for bpmn-js services (`Modeling`, `ElementRegistry`, etc.)                                                                   |
| `src/constants.ts`              | Centralised magic numbers (`STANDARD_BPMN_GAP`, `ELEMENT_SIZES`)                                                                                   |
| `src/headless-canvas.ts`        | jsdom setup, SVG/CSS polyfills, lazy `BpmnModeler` init                                                                                            |
| `src/elk-layout.ts`             | ELK-based layout engine — Sugiyama layered algorithm via `elkjs` for automatic diagram arrangement                                                 |
| `src/diagram-manager.ts`        | In-memory `Map<string, DiagramState>` store, modeler creation helpers                                                                              |
| `src/tool-definitions.ts`       | Thin barrel collecting co-located `TOOL_DEFINITION` exports from handlers                                                                          |
| `src/handlers/index.ts`         | Handler barrel + `dispatchToolCall` router                                                                                                         |
| `src/handlers/helpers.ts`       | Shared utilities: `validateArgs`, `requireDiagram`, `requireElement`, `getVisibleElements`, `upsertExtensionElement`, `resolveOrCreateError`, etc. |
| `src/linter.ts`                 | Centralised bpmnlint integration: lint config, Linter instance, `lintDiagram()`, `appendLintFeedback()`                                            |
| `src/bpmnlint-types.ts`         | TypeScript type declarations for bpmnlint (`LintConfig`, `LintResults`, `FlatLintIssue`)                                                           |
| `src/bpmnlint-plugin-bpmn-mcp/` | Custom bpmnlint plugin with Camunda 7 (Operaton) specific rules                                                                                    |
| `src/persistence.ts`            | Optional file-backed diagram persistence — auto-save to `.bpmn` files, load on startup                                                             |
| `src/handlers/label-utils.ts`   | Pure geometry helpers for label-overlap detection (rect intersection, scoring)                                                                     |
| `src/handlers/adjust-labels.ts` | Post-processing label adjustment to avoid connection/label overlaps                                                                                |
| `src/handlers/<name>.ts`        | One handler file per tool — exports `handleXxx` + `TOOL_DEFINITION`                                                                                |

**Core pattern:**

1. A shared `jsdom` instance polyfills browser APIs (SVG, CSS, structuredClone) so `bpmn-js` can run headlessly.
2. Diagrams are stored in-memory in a `Map<string, DiagramState>` keyed by generated IDs.
3. **32 MCP tools** are exposed (see "Tool Naming" below).
4. Each tool handler manipulates the `bpmn-js` modeler API (`modeling`, `elementFactory`, `elementRegistry`) and returns JSON or raw XML/SVG.
5. `camunda-bpmn-moddle` is registered as a moddle extension, enabling Camunda-specific attributes (e.g. `camunda:assignee`, `camunda:class`, `camunda:formKey`) on elements.
6. Each handler file **co-locates** its MCP tool definition (`TOOL_DEFINITION`) alongside the handler function, preventing definition drift.
7. **bpmnlint** is integrated for BPMN validation. The `McpPluginResolver` wraps bpmnlint's `NodeResolver` to support both npm plugins (`bpmnlint-plugin-camunda-compat`) and the bundled custom plugin (`bpmnlint-plugin-bpmn-mcp`). Mutating tool handlers call `appendLintFeedback()` to append error-level lint issues to their response.
8. **Label adjustment** runs after layout and connection operations, using geometry-based scoring to position external labels away from connection paths.

## Tool Naming Convention

**Every tool name includes `bpmn`** to avoid collisions with other MCPs.

- **Core structural tools:** `create_bpmn_diagram`, `add_bpmn_element`, `connect_bpmn_elements`, `delete_bpmn_element`, `move_bpmn_element`, `list_bpmn_elements`, `validate_bpmn_diagram`, `align_bpmn_elements`, `distribute_bpmn_elements`, `export_bpmn`, `import_bpmn_xml`
- **Property / extension tools:** `get_bpmn_element_properties`, `set_bpmn_element_properties`, `set_bpmn_input_output_mapping`, `set_bpmn_event_definition`, `set_bpmn_form_data`, `set_bpmn_camunda_error`, `set_bpmn_loop_characteristics`, `set_bpmn_script`
- **Collaboration & data tools:** `create_bpmn_collaboration`, `create_bpmn_data_association`
- **Export tools:** `export_bpmn_subprocess`
- **History tools:** `undo_bpmn_change`, `redo_bpmn_change`, `diff_bpmn_diagrams`
- **Batch tools:** `batch_bpmn_operations`
- **Utility tools:** `delete_bpmn_diagram`, `list_bpmn_diagrams`, `clone_bpmn_diagram`, `layout_bpmn_diagram`, `lint_bpmn_diagram`, `adjust_bpmn_labels`

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
- Mutating handlers call `appendLintFeedback()` from `src/linter.ts` to append bpmnlint error-level issues to their responses. Read-only handlers (`list-elements`, `get-properties`, `lint`) and `create-diagram` do not.
- `export_bpmn` runs an implicit lint gate: export is blocked when error-level issues exist, unless `skipLint: true` is passed. Tests that call `handleExportXml`/`handleExportSvg` on incomplete diagrams must pass `skipLint: true`.

## Architecture Decision Records

### Why tool definitions are co-located with handlers

Each handler file exports both `handleXxx` and `TOOL_DEFINITION`. This keeps the MCP schema in sync with the implementation, prevents drift, and makes it easy to see exactly what a tool accepts without switching files. `tool-definitions.ts` is a thin barrel that collects them.

### Why `auto_layout` was merged into `layout_diagram`

`auto_layout` was a strict subset of `layout_diagram` (which called it internally). Having both confused AI callers with a needless choice. Merged into `layout_bpmn_diagram`.

### Why `layout_bpmn_diagram` uses elkjs instead of bpmn-auto-layout

`bpmn-auto-layout` produces decent left-to-right layouts for simple flows but struggles with parallel branches that reconverge, nested subprocesses, and boundary-event recovery paths. `elkjs` implements the Sugiyama layered algorithm (ELK Layered) which handles these complex topologies correctly — proper layer assignment, crossing minimisation via `LAYER_SWEEP`, and `NETWORK_SIMPLEX` node placement. The `elkLayout()` function in `src/elk-layout.ts` works directly with the bpmn-js modeler (no XML round-trip), builds an ELK graph from the element registry, runs ELK layout, applies positions back via `modeling.moveElements`, snaps same-layer elements to a common Y (vertical alignment), and applies ELK's own orthogonal edge routes as connection waypoints. `bpmn-auto-layout` is retained solely for DI generation in `import_bpmn_xml` when imported XML lacks `bpmndi:BPMNShape`/`bpmndi:BPMNEdge` elements.

### Why `export_bpmn_xml` and `export_bpmn_svg` were merged into `export_bpmn`

Both did the same thing with different output formats. A single tool with `format: "xml" | "svg"` is cleaner.

### Why `set_loop_characteristics` is the canonical loop tool

`set_element_properties` had a `loopCharacteristics` passthrough that duplicated the dedicated tool. The dedicated tool has a better schema with typed params. The passthrough was removed.

### Why bpmnlint is integrated via McpPluginResolver

bpmnlint uses dynamic `require()` to resolve rules and configs at runtime. Rather than fighting esbuild bundling with a `StaticResolver`, bpmnlint and `bpmnlint-plugin-camunda-compat` are marked `external` in esbuild (same as `bpmn-js` and `jsdom`), letting `NodeResolver` work naturally from `node_modules`. The `McpPluginResolver` wraps `NodeResolver` and intercepts requests for our bundled `bpmnlint-plugin-bpmn-mcp` plugin, serving its rules and configs from ES imports within the bundle.

### Why `validate_bpmn_diagram` fully delegates to bpmnlint

The hand-written checks in the original `validate` handler overlapped significantly with bpmnlint rules (`start-event-required`, `end-event-required`, `no-disconnected`, `label-required`). Delegating to bpmnlint eliminates maintenance burden while adding 27+ additional checks. Camunda-specific checks (`camunda-topic-without-external-type`, `gateway-missing-default`) are now registered as proper bpmnlint rules in `bpmnlint-plugin-bpmn-mcp` and resolved via `McpPluginResolver`, so the validate handler no longer needs manual check functions.

### Why implicit lint feedback only includes errors

`appendLintFeedback()` filters to error-severity issues only. Including warnings would make every response verbose during incremental diagram construction. The explicit `lint_bpmn_diagram` tool returns all severities for callers who want the full picture.

### Why `createLinter()` creates a fresh Linter per call

bpmnlint's `Linter` class caches rule factory results in `this.cachedRules`. Some rules (e.g. `no-duplicate-sequence-flows`) use closure state (`const keyed = {}`) that accumulates across `lint()` calls and never resets. When a single Linter instance was reused, this caused false positives. `createLinter()` creates a fresh instance each time to ensure clean rule closures.

### Why `export_bpmn` has an implicit lint gate

During real usage, AI callers would export invalid diagrams without checking lint first, producing BPMN XML that engines reject. The implicit lint gate in `export_bpmn` catches error-level issues before export. A `skipLint` parameter allows callers to bypass this when they know what they're doing (e.g. exporting a work-in-progress).

### Why bottom labels have extra spacing (`ELEMENT_LABEL_BOTTOM_EXTRA`)

Start and End events are small (36×36px). With only `ELEMENT_LABEL_DISTANCE = 10` of gap, bottom-placed labels visually touch the event circle. `ELEMENT_LABEL_BOTTOM_EXTRA = 5` adds extra breathing room for the bottom position only, keeping the other three positions unchanged.

### Why label adjustment is geometry-based (not behavior-based)

bpmn-js has `AdaptiveLabelPositioningBehavior` but it only considers connection direction quadrants, not actual bounding-box intersection. Our approach scores 4 candidate positions (top/bottom/left/right) against all connection segments and other labels using Cohen-Sutherland intersection tests, picking the position with the lowest collision score.

### Why element IDs use sequential counters instead of random suffixes

bpmn-js generates IDs like `Activity_0m4w27p` with random hex suffixes. These are hard to distinguish and remember during interactive diagram construction. `generateDescriptiveId()` now always returns a meaningful ID: `UserTask_EnterName` when a name is given, or `StartEvent_1`, `Gateway_2` when unnamed. Sequential counters are short, predictable, and easy to reference in subsequent tool calls. The same pattern applies to flows via `generateFlowId()` (`Flow_1`, `Flow_2`, or `Flow_EnterName_to_HasSurname`).

### Why all tool names include "bpmn"

When multiple MCP servers are active, tool names must be globally unique. Generic names like `delete_diagram` or `set_form_data` could collide with tools from other MCPs. Adding `bpmn` to every tool name (e.g. `delete_bpmn_diagram`, `set_bpmn_form_data`) eliminates this risk. No backward-compat aliases — MCP tool namespaces don't need them.

## Key Gotchas

- The `bpmn-js` browser bundle is loaded via `eval` inside jsdom; polyfills for `SVGMatrix`, `getBBox`, `getScreenCTM`, `transform`, `createSVGMatrix`, and `createSVGTransform` are manually defined in `headless-canvas.ts`.
- Diagram state is in-memory by default. Optional file-backed persistence can be enabled via `enablePersistence(dir)` from `src/persistence.ts`.
- The `jsdom` instance and `BpmnModeler` constructor are lazily initialized on first use and then reused.
- bpmnlint requires moddle root elements (not raw XML). Use `getDefinitionsFromModeler()` from `src/linter.ts` to extract the `bpmn:Definitions` element from a bpmn-js modeler.
- **Do not cache a bpmnlint `Linter` instance.** Some rules use closure state that accumulates across calls. `createLinter()` in `src/linter.ts` always creates a fresh instance.
- The `DEFAULT_LINT_CONFIG` extends `bpmnlint:recommended`, `plugin:camunda-compat/camunda-platform-7-24`, and `plugin:bpmn-mcp/recommended`. It downgrades `label-required` and `no-disconnected` to warnings (AI callers build diagrams incrementally), and disables `no-overlapping-elements` (false positives in headless mode).
- Custom bpmnlint rules live in `src/bpmnlint-plugin-bpmn-mcp/` and are registered as a proper bpmnlint plugin via `McpPluginResolver` in `src/linter.ts`. They can be referenced in config as `plugin:bpmn-mcp/recommended` or individually as `bpmn-mcp/rule-name`.
- Element IDs are always deterministic: named elements get `UserTask_EnterName`, unnamed elements get sequential `StartEvent_1`, `Gateway_2`, flows get `Flow_1` or `Flow_Begin_to_End`. No random suffixes.
- `elkjs` is dynamically imported and externalized in esbuild (same as `bpmn-js`). It runs synchronously in the headless Node.js/jsdom environment (no web workers). The ELK graph is built from `elementRegistry.getAll()`, boundary events are excluded (they follow their host automatically via `modeling.moveElements`).
- bpmnlint has no rule to detect semantic gateway-type mismatches (e.g. using a parallel gateway to merge mutually exclusive paths). Such errors require manual review or domain-specific rules.
