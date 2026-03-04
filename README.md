# bpmn-js-mcp

MCP server that lets AI assistants create and manipulate BPMN 2.0 workflow diagrams. Uses [bpmn-js](https://bpmn.io/toolkit/bpmn-js/) headlessly via jsdom to produce valid BPMN XML and SVG output with full [Camunda 7](https://docs.camunda.org/manual/7.24/) (Operaton) extension support.

![BPMN Diagram Example](./docs/images/bpmn.png)

> [!WARNING]
> This fork is primarily developed with the assistance of AI coding agents.

## Setup

### `./vscode/mcp.json`

```json
{
  "servers": {
    "bpmn": {
      "type": "stdio",
      "command": "npx",
      "args": ["git+https://github.com/datakurre/bpmn-js-mcp"]
    }
  }
}
```

## AI Agent Instructions

> **When working with `.bpmn` files, always use the BPMN MCP tools instead of editing BPMN XML directly.** The MCP tools ensure valid BPMN 2.0 structure, proper diagram layout coordinates, and semantic correctness that hand-editing XML cannot guarantee.

**To modify an existing `.bpmn` file**, use `import_bpmn_xml` to load it, make changes with the MCP tools, then `export_bpmn` and write the result back to the file.

**To create a new diagram**, use `create_bpmn_diagram`, build it with `add_bpmn_element` / `connect_bpmn_elements`, then `export_bpmn` to get the XML.

### BPMN Modeling Best Practices

Follow these conventions when creating BPMN diagrams:

- **Model left-to-right** — avoid flows that go backwards (right-to-left).
- **Name every element** — use human-readable business language, not technical identifiers.
- **Naming conventions**:
  - Tasks: verb + object (`"Process Order"`, `"Send Invoice"`).
  - Events: object + state (`"Order Received"`, `"Payment Completed"`).
  - Exclusive/Inclusive gateways: yes/no question ending with `?` (`"Order valid?"`, `"Payment successful?"`). Label outgoing flows as answers.
  - Don't name parallel gateways, joining gateways, or event-based gateways unless it adds meaning.
- **Prefer explicit gateways** — don't use conditional flows directly out of tasks.
- **Show start and end events explicitly** — required for executable processes.
- **Avoid lanes by default** — use collaboration diagrams (separate pools + message flows) for role separation.
- **Avoid retry loops in BPMN** — use engine-level retry mechanisms instead (job retries, external task backoff).
- **Use receive tasks + boundary events for waiting** — for Operaton/Camunda 7, prefer a receive task with boundary timers/messages over event-based gateway patterns.
- **Model the happy path first**, then add exceptions incrementally with boundary events and event subprocesses.

See [docs/modeling-best-practices.md](docs/modeling-best-practices.md) for full guidance.

### Layout Workflow

For best results, follow this recommended workflow after structural changes:

1. **Build structure** — `add_bpmn_element` / `connect_bpmn_elements` to create the flow.
2. **Auto-layout** — `layout_bpmn_diagram` to arrange elements (use `scopeElementId` to scope to a pool/subprocess).
3. **Fine-tune** — `align_bpmn_elements` for alignment (with `compact=true` or `orientation` for distribution).
4. **Fix labels** — `layout_bpmn_diagram` with `labelsOnly: true` to resolve label overlaps.

No separate "repair layout" tool is needed — chain these existing tools for fine-grained control.

## Available Tools (39)

### Core BPMN Tools

| Tool                            | Description                                                          |
| ------------------------------- | -------------------------------------------------------------------- |
| `create_bpmn_diagram`           | Create a new BPMN diagram                                            |
| `add_bpmn_element`              | Add elements (with `flowId` to insert into existing flows)           |
| `add_bpmn_element_chain`        | Add a chain of elements connected in sequence                        |
| `connect_bpmn_elements`         | Connect elements with sequence/message flows or associations         |
| `delete_bpmn_element`           | Remove an element or connection                                      |
| `move_bpmn_element`             | Move, resize, or reassign an element to a lane                       |
| `replace_bpmn_element`          | Replace an element's type preserving connections and position        |
| `set_bpmn_connection_waypoints` | Set custom waypoints on a connection for manual routing              |
| `list_bpmn_elements`            | List elements with filters (name pattern, type, property)            |
| `get_bpmn_element_properties`   | Inspect all properties of an element                                 |
| `validate_bpmn_diagram`         | Validate using bpmnlint (recommended + Camunda 7 + custom MCP rules) |
| `export_bpmn`                   | Export as BPMN 2.0 XML or SVG (with implicit lint gate)              |
| `import_bpmn_xml`               | Import existing BPMN XML (auto-layout if no DI)                      |
| `manage_bpmn_root_elements`     | Create or update shared Message and Signal definitions               |

### Layout & Alignment Tools

| Tool                  | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `layout_bpmn_diagram` | Auto-layout using rebuild engine (labelsOnly mode available) |
| `align_bpmn_elements` | Align or distribute elements (with optional compaction)      |

### Camunda 7 / Operaton Tools

| Tool                               | Description                                         |
| ---------------------------------- | --------------------------------------------------- |
| `set_bpmn_element_properties`      | Set standard and Camunda extension properties       |
| `set_bpmn_input_output_mapping`    | Configure input/output parameter mappings           |
| `set_bpmn_event_definition`        | Add error, timer, message, signal event definitions |
| `set_bpmn_form_data`               | Configure generated task forms (Camunda FormData)   |
| `set_bpmn_camunda_listeners`       | Set listeners and error handling on elements        |
| `set_bpmn_loop_characteristics`    | Configure loop/multi-instance markers               |
| `set_bpmn_call_activity_variables` | Set variable mappings on CallActivity elements      |

### Collaboration Tools

| Tool                                      | Description                                                  |
| ----------------------------------------- | ------------------------------------------------------------ |
| `create_bpmn_participant`                 | Create participant pools in a collaboration diagram          |
| `create_bpmn_lanes`                       | Create swimlanes within a participant pool                   |
| `assign_bpmn_elements_to_lane`            | Bulk-assign elements to a lane                               |
| `wrap_bpmn_process_in_collaboration`      | Migrate a process into a collaboration with pools            |
| `handoff_bpmn_to_lane`                    | Create a cross-lane handoff with auto-connection             |
| `convert_bpmn_collaboration_to_lanes`     | Convert multi-pool collaboration into single pool with lanes |
| `autosize_bpmn_pools_and_lanes`           | Resize pools and lanes to fit contained elements             |
| `analyze_bpmn_lanes`                      | Analyze, suggest, and validate lane assignments              |
| `redistribute_bpmn_elements_across_lanes` | Rebalance element placement across existing lanes            |

### Utility Tools

| Tool                          | Description                                        |
| ----------------------------- | -------------------------------------------------- |
| `delete_bpmn_diagram`         | Remove a diagram from memory                       |
| `list_bpmn_diagrams`          | List all diagrams or get a detailed summary        |
| `list_bpmn_process_variables` | List all process variables referenced in a diagram |
| `clone_bpmn_diagram`          | Duplicate a diagram for experimentation            |
| `diff_bpmn_diagrams`          | Compare two diagrams and return structured diff    |
| `bpmn_history`                | Undo or redo changes (supports multiple steps)     |
| `batch_bpmn_operations`       | Execute multiple operations in a single call       |

### Automatic Lint Feedback

All mutating tools automatically append bpmnlint error-level issues to their response. This gives AI callers immediate feedback when an operation introduces a rule violation. The `validate_bpmn_diagram` tool returns all severities for a full report.

The default config extends `bpmnlint:recommended`, `plugin:camunda-compat/camunda-platform-7-24`, and `plugin:bpmn-mcp/recommended`. Key tuning for AI-generated diagrams:

- `label-required` and `no-disconnected` → `warn` (diagrams are built incrementally)
- `no-overlapping-elements` → `off` (false positives in headless layout mode)
- `fake-join` → `info` (boundary-event retry patterns produce valid fake-joins)
- `camunda-compat/history-time-to-live` → `warn` (required for Operaton history cleanup)

The custom `plugin:bpmn-mcp/recommended` adds ~45 Camunda 7 / Operaton-specific rules covering gateway logic, task configuration, lane organization, collaboration patterns, subprocess validation, and layout quality. Override any rule with a `.bpmnlintrc` file in the project root.

### MCP Resources

Stable, addressable read-context endpoints for AI callers to re-ground context mid-conversation:

| URI                                 | Description                                                       |
| ----------------------------------- | ----------------------------------------------------------------- |
| `bpmn://diagrams`                   | List all in-memory diagrams                                       |
| `bpmn://diagram/{id}/summary`       | Lightweight diagram summary (element counts, names, connectivity) |
| `bpmn://diagram/{id}/lint`          | Validation issues with fix suggestions                            |
| `bpmn://diagram/{id}/variables`     | Process variable references with read/write access patterns       |
| `bpmn://diagram/{id}/xml`           | Current BPMN 2.0 XML for re-grounding                             |
| `bpmn://guides/executable-camunda7` | Constraints and best practices for Camunda 7 / Operaton           |

### MCP Prompts

Reusable modeling workflows that guide AI callers through multi-tool patterns:

| Prompt                         | Description                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `create-executable-process`    | Step-by-step guide to create a complete executable BPMN process for Operaton / Camunda 7 |
| `convert-to-collaboration`     | Convert a single-pool process into a collaboration with multiple participants            |
| `add-sla-timer-pattern`        | Add SLA timers using boundary events (interrupting or non-interrupting)                  |
| `add-approval-pattern`         | Add an approval pattern with gateway, conditions, default flow, and form fields          |
| `add-error-handling-pattern`   | Add error handling with boundary events or event subprocesses                            |
| `add-parallel-tasks-pattern`   | Add parallel gateway pattern with concurrent branches and synchronization                |
| `add-decision-gateway-pattern` | Add an exclusive gateway with multiple conditional branches and a default flow           |
| `create-lane-based-process`    | Create a swimlane-based process with role separation and handoffs between lanes          |

## Output Compatibility

Generated BPMN 2.0 XML works with [Camunda Modeler](https://camunda.com/download/modeler/), [bpmn.io](https://bpmn.io/), and any BPMN 2.0 compliant tool.

## Development

```bash
npm run dev        # auto-reload server on code changes (runs watch + nodemon)
npm run watch      # rebuild on change
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run format     # format with Prettier
npm test           # vitest
```

### Auto-reload Setup

For development with VS Code's MCP integration, the server will automatically reload when you make code changes:

1. The `watch` script (esbuild --watch) rebuilds `dist/index.js` when source files change
2. The `dev` script (nodemon) watches `dist/index.js` and restarts the server on rebuild
3. `.vscode/mcp.json` is configured to use `npm run dev`
4. Nodemon is configured with `--quiet` and stdio passthrough to ensure MCP protocol compatibility

To develop with auto-reload:

- Start the `watch` script in one terminal: `npm run watch`
- The MCP server (configured in VS Code) will automatically restart via nodemon when the build completes
- Nodemon runs in quiet mode and passes stdin/stdout directly to the server process, maintaining MCP stdio compatibility

Or equivalently via `make`:

```bash
make format check test   # format, typecheck + lint, run tests
```

See [AGENTS.md](AGENTS.md) for architecture details and decision records.

## Contributing

### Getting Started

```bash
git clone https://github.com/datakurre/bpmn-js-mcp
cd bpmn-js-mcp
npm install
npm run build   # compile TypeScript → dist/ via esbuild
npm test        # run Vitest test suite (~1 300 tests)
npm run lint    # ESLint (sonarjs + unicorn + typescript-eslint)
npm run typecheck  # tsc --noEmit (type check only, no emit)
```

Node.js **≥ 18** is required.

### Project Layout

```
src/handlers/      tool handlers, one file per tool domain
src/rebuild/       topology-driven layout engine
src/bpmnlint-plugin-bpmn-mcp/  custom lint rules
src/eval/          layout quality scoring harness
test/              Vitest tests mirroring src/ structure
docs/              architecture, best practices, ADRs
agents/adrs/       Architecture Decision Records
```

### Adding a New MCP Tool

1. Create `src/handlers/<domain>/<name>.ts` — export both the handler function and a `TOOL_DEFINITION` constant.
2. Add one entry to `TOOL_REGISTRY` in `src/handlers/index.ts`.
3. Add a test in `test/handlers/<domain>/<name>.test.ts`.

The dispatch map and `TOOL_DEFINITIONS` array are auto-derived from `TOOL_REGISTRY`.

### Key Constraints

- **Never edit `.bpmn` files directly** — always use the MCP tools (`import_bpmn_xml` → edit → `export_bpmn`).
- **Never write BPMN XML via terminal heredocs** — line-wrapping can corrupt element names. Use `create_file` or MCP export.
- `src/rebuild/` and `src/bpmnlint-plugin-bpmn-mcp/` must not import from `src/handlers/` (enforced by ESLint).
- Mutating handlers must call `appendLintFeedback()` from `src/linter.ts` to surface error-level issues.

See [AGENTS.md](AGENTS.md) for full architecture details and decision records.

## License

MIT
