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
    "bpmn-js-mcp": {
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
2. **Auto-layout** — `layout_bpmn_diagram` to arrange elements (use `elementIds` for partial re-layout, `scopeElementId` to scope to a pool/subprocess).
3. **Fine-tune** — `align_bpmn_elements` for alignment (with `compact=true` or `orientation` for distribution).
4. **Fix labels** — `adjust_bpmn_labels` to resolve label overlaps.

No separate "repair layout" tool is needed — chain these existing tools for fine-grained control.

## Available Tools (34)

### Core BPMN Tools

| Tool                          | Description                                                          |
| ----------------------------- | -------------------------------------------------------------------- |
| `create_bpmn_diagram`         | Create a new BPMN diagram                                            |
| `add_bpmn_element`            | Add elements (with `flowId` to insert into existing flows)           |
| `insert_bpmn_element`         | Insert an element into an existing sequence flow                     |
| `connect_bpmn_elements`       | Connect elements with sequence/message flows or associations         |
| `delete_bpmn_element`         | Remove an element or connection                                      |
| `move_bpmn_element`           | Move, resize, or reassign an element to a lane                       |
| `replace_bpmn_element`        | Replace an element's type preserving connections and position        |
| `duplicate_bpmn_element`      | Duplicate an existing element within the same diagram                |
| `list_bpmn_elements`          | List elements with filters (name pattern, type, property)            |
| `get_bpmn_element_properties` | Inspect all properties of an element                                 |
| `validate_bpmn_diagram`       | Validate using bpmnlint (recommended + Camunda 7 + custom MCP rules) |
| `export_bpmn`                 | Export as BPMN 2.0 XML or SVG (with implicit lint gate)              |
| `import_bpmn_xml`             | Import existing BPMN XML (auto-layout if no DI)                      |
| `create_bpmn_collaboration`   | Create collaboration diagrams with multiple participants (pools)     |
| `manage_bpmn_root_elements`   | Create or update shared Message and Signal definitions               |

### Layout & Alignment Tools

| Tool                  | Description                                               |
| --------------------- | --------------------------------------------------------- |
| `layout_bpmn_diagram` | Auto-layout using ELK layered algorithm with grid snap    |
| `align_bpmn_elements` | Align or distribute elements (with optional compaction)   |
| `adjust_bpmn_labels`  | Adjust external labels to reduce overlap with connections |

### Camunda 7 / Operaton Tools

| Tool                               | Description                                         |
| ---------------------------------- | --------------------------------------------------- |
| `set_bpmn_element_properties`      | Set standard and Camunda extension properties       |
| `set_bpmn_input_output_mapping`    | Configure input/output parameter mappings           |
| `set_bpmn_event_definition`        | Add error, timer, message, signal event definitions |
| `set_bpmn_form_data`               | Configure generated task forms (Camunda FormData)   |
| `set_bpmn_camunda_listeners`       | Set listeners and error handling on elements        |
| `set_bpmn_loop_characteristics`    | Configure loop/multi-instance markers               |
| `set_bpmn_script`                  | Set inline script content on ScriptTask elements    |
| `set_bpmn_call_activity_variables` | Set variable mappings on CallActivity elements      |

### Utility Tools

| Tool                          | Description                                        |
| ----------------------------- | -------------------------------------------------- |
| `delete_bpmn_diagram`         | Remove a diagram from memory                       |
| `list_bpmn_diagrams`          | List all diagrams or get a detailed summary        |
| `summarize_bpmn_diagram`      | Get a lightweight summary of a diagram             |
| `list_bpmn_process_variables` | List all process variables referenced in a diagram |
| `clone_bpmn_diagram`          | Duplicate a diagram for experimentation            |
| `bpmn_history`                | Undo or redo changes (supports multiple steps)     |
| `diff_bpmn_diagrams`          | Compare two diagrams and return structured diff    |
| `batch_bpmn_operations`       | Execute multiple operations in a single call       |

### Automatic Lint Feedback

All mutating tools automatically append bpmnlint error-level issues to their response. This gives AI callers immediate feedback when an operation introduces a rule violation. The `lint_bpmn_diagram` tool returns all severities for a full report.

The default config extends `bpmnlint:recommended`, `plugin:camunda-compat/camunda-platform-7-24`, and `plugin:bpmn-mcp/recommended`, with `label-required` and `no-disconnected` downgraded to warnings for incremental construction.

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

## License

MIT
