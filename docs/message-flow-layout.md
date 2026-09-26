# Message flow layout and optimization

Guidelines for creating readable collaboration diagrams with message flows.

## When to use message flows vs lanes

**Message flows** connect elements across pool boundaries. They represent asynchronous communication between independent participants.

**Use message flows when:**

- Participants are separate organizations, systems, or services.
- Communication is asynchronous (request → wait → response).
- Each participant has its own process lifecycle.

**Use lanes instead when:**

- Participants are roles within the same department/organization.
- Work flows sequentially between roles without explicit message exchange.
- A single process engine will orchestrate the entire flow.

See [modeling-best-practices.md](modeling-best-practices.md#when-to-use-pools-vs-lanes) for the full decision guide.

## Camunda 7 / Operaton pattern

In Camunda 7, **only one pool is executable**. Additional pools must be **collapsed** (thin bars representing external systems).

```
┌─────────────────────────────────────────────────────────┐
│ Customer (collapsed)                                    │
└─────────────────────────────────────────────────────────┘
       │ ↓ message              ↑ message │
┌──────┼─────────────────────────────────┼────────────────┐
│ Helpdesk (expanded, executable)        │                │
│  (Start) → [Receive Request] → [Process] → [Reply] → (End) │
└─────────────────────────────────────────────────────────┘
```

**MCP workflow:**

1. `create_bpmn_participant` with `collapsed: true` for external participants.
2. Build the process flow inside the expanded (executable) pool.
3. Use `connect_bpmn_elements` to create message flows between pools — the tool auto-detects `bpmn:MessageFlow` for cross-pool connections.

## Layout strategies for message flows

### 1. Vertical alignment of paired events

The clearest message flow layout places corresponding send/receive elements at the **same X coordinate** so message flows are vertical (straight down/up).

```
Pool A:   [Send Order]           [Receive Confirmation]
               │                         ↑
               ↓                         │
Pool B:   [Receive Order] → [Process] → [Send Confirmation]
```

**How to achieve this:**

- After running `layout_bpmn_diagram`, use `align_bpmn_elements` with `alignment: "center"` on paired send/receive elements.
- Alternatively, use `move_bpmn_element` to manually set the X coordinate of message endpoints.

### 2. Pool ordering to minimize crossings

Place pools that exchange the most messages **adjacent** to each other. Diagonal message flows that cross other pools are hard to read.

**Good:**

```
Pool A (many messages to B)
Pool B (many messages to A and some to C)
Pool C (messages to B only)
```

**Bad:**

```
Pool A (messages to C cross Pool B)
Pool B
Pool C
```

Use `move_bpmn_element` to reorder pools vertically after creation.

### 3. Collapsed pools as thin bars

For non-executable participants, collapsed pools reduce visual noise:

```
┌─ External API ──────────────────────────┐  (collapsed, ~120px tall)
└─────────────────────────────────────────┘
       │                        ↑
┌──────┼────────────────────────┼─────────┐
│ Main Process (expanded)       │         │
│  → [Call API] ────────→ [Handle Response] → │
└─────────────────────────────────────────┘
```

### 4. Simple integrations: prefer service tasks

When the external system is not a meaningful message partner (e.g., a REST API call with immediate response), **skip the collaboration** and use a `bpmn:ServiceTask` instead:

```
(Start) → [ServiceTask: Call API] → [Process Result] → (End)
```

Configure with `camunda:type="external"` and `camunda:topic` for Camunda 7 external task workers.

## Troubleshooting message flow layout

### Long diagonal message flows

**Symptom:** Message flows cross the entire diagram diagonally.

**Fix:**

1. Reorder pools to place communicating participants adjacent.
2. Align paired send/receive elements at the same X coordinate.
3. Consider splitting complex interactions into multiple message exchanges with intermediate events aligned vertically.

### Message flows crossing other pools

**Symptom:** A message flow from Pool A to Pool C visually crosses Pool B.

**Fix:**

1. Reorder pools so A and C are adjacent.
2. If reordering is not possible, use **link events** to break the flow into segments that are easier to follow.

### Pool too narrow for message flow endpoints

**Symptom:** Message flow endpoints are cramped at pool edges.

**Fix:**

1. Use `layout_bpmn_diagram` with `autosizeOnly: true` to auto-expand pools.
2. Or manually resize with `move_bpmn_element` setting `width` to a larger value.
3. After resizing, run `layout_bpmn_diagram` to redistribute elements within the expanded pool.

## MCP tool reference for message flows

| Task                  | Tool                                         | Notes                                          |
| --------------------- | -------------------------------------------- | ---------------------------------------------- |
| Create collaboration  | `create_bpmn_participant`                    | Set `collapsed: true` for non-executable pools |
| Connect across pools  | `connect_bpmn_elements`                      | Auto-detects `bpmn:MessageFlow`                |
| Define messages       | `manage_bpmn_root_elements`                  | Create shared `bpmn:Message` definitions       |
| Set message on event  | `set_bpmn_event_definition`                  | With `messageRef` to reference shared message  |
| Align paired elements | `align_bpmn_elements`                        | Use `alignment: "center"` on paired elements   |
| Resize pools          | `move_bpmn_element`                          | Set `width`/`height`                           |
| Auto-size pools       | `layout_bpmn_diagram` (`autosizeOnly: true`) | Auto-expands to fit content                    |
| Full layout           | `layout_bpmn_diagram`                        | Includes pool/lane finalization                |
