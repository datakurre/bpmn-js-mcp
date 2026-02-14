# Modeling best practices

## Readability and communication

- **Name every element**; the clarity of a model is usually limited by its labels.
- **Model left-to-right** and avoid flows that go “backwards” (incoming on the right / outgoing on the left).
- **Prefer symmetry**: structure related split/join gateways as visually obvious blocks (including nested blocks).
- **Keep sequence flows readable**
  - Avoid excessive crossings and long, multi-page flows.
  - Use **link events** when a direct flow would become too long.
  - Overlap flows only when it clearly reduces clutter and doesn’t confuse direction.
- **Model explicitly when it improves understanding**
  - Use explicit gateways instead of “conditional flows directly out of tasks”.
  - Show start and end events explicitly (also important for executable models).
  - Separate splitting and joining concerns into distinct gateways when that improves clarity.
  - Show XOR markers explicitly (don’t use “blank” gateways).
- **Avoid lanes by default**
  - Lanes often reduce readability and make later change harder.
  - For operational responsibility views, prefer **collaboration diagrams** (separate pools + message flows).
- **Use collaboration diagrams well**
  - Prefer one coherent process per pool (except event subprocesses).
  - Reorder pools to reduce message-flow crossings.
- **Model system interaction deliberately**
  - Use **data stores** for systems that are primarily persistence.
  - Use (collapsed) **pools** for systems that have their own meaningful process behavior.

## When to use pools vs lanes

**Pools** (participants) represent independent process boundaries — separate organizations, departments, or systems that communicate via **message flows**.

- In Camunda 7 / Operaton, **only one pool is executable** — additional pools should be **collapsed** (thin bars) to document external message endpoints.
- Use pools when participants have their own process lifecycle and communicate asynchronously.
- Sequence flows **cannot cross pool boundaries** — use message flows between pools.

**Lanes** subdivide a single pool into horizontal bands representing **roles or responsibilities** within the same process.

- Use lanes when showing who does what within a single organization/department.
- Sequence flows can cross lane boundaries freely (they share the same process).
- Keep lane structures simple: 2–3 lanes is usually sufficient. More than 4 lanes typically indicates the process should be decomposed.
- **Avoid zigzag flows** (A → B → A lane crossings) — they reduce readability. If a task zigzags back, consider moving it to the same lane as its neighbors.
- **Name lanes by role** (e.g., "Requester", "Approver", "Finance") rather than by task type.

**Decision guide:**

| Situation                          | Use                            |
| ---------------------------------- | ------------------------------ |
| Different organizations / systems  | Pools (collapsed for external) |
| Roles within one organization      | Lanes                          |
| Technical vs human task separation | Lanes (or skip lanes entirely) |
| External API / partner integration | Collapsed pool + message flows |
| Simple process, single team        | No pools or lanes needed       |

- **Use data objects sparingly**: show only the most important data aspects to avoid visual noise.
- **Avoid changing symbol size and excessive color**
  - Use annotations for extra detail.
  - If you color anything, keep it subtle (e.g., lightly emphasize the happy path).

## Naming conventions (labels)

- **Activities (tasks)**: verb + object in infinitive (e.g., “Validate order”).
- **Subprocesses / call activities**: object + (nominalized) verb (e.g., “Order validation”).
- **Events**: object + state (e.g., “Invoice paid”, “Order canceled”).
- **Exclusive gateways**: pose a **question** (e.g., “Order complete?”).
  - Label outgoing flows as **answers/conditions**.
- **Inclusive gateways**: use a question only when it still makes sense; otherwise focus on labeling each outgoing condition.
- **Don’t name** event-based gateways, parallel gateways, and joining gateways unless you truly add meaning by doing so.
- **Prefer sentence case**, avoid technical terms, and avoid abbreviations (or explain them).

## Model beyond the happy path (exceptions and deviations)

- **Model the happy path first**, then add exceptions incrementally (one issue at a time).
- Choose the modeling construct based on _where the deviation can occur_:
  - **At a specific point**: data-based gateway (results) or event-based gateway (external event/timeout).
  - **During an activity**: boundary events.
  - **At almost any time**: (interrupting/non-interrupting) event subprocess.
- **Keep business vs technical concerns separate**
  - Model business-relevant exception paths.
  - Avoid encoding “purely technical retries” in BPMN (see “Operational notes” below).
- **Use receive tasks + boundary events for executable waiting**
  - For Operaton/Camunda 7, prefer a **receive task** (or other stable wait state) with boundary timers/messages when you need to stay “ready to receive”.
  - This avoids “not ready to receive” gaps that can happen in some event-based-gateway patterns.
- **Multi-phase escalation**
  - Prefer patterns that keep the instance continuously in a wait state (e.g., receive task + non-interrupting reminder timer + interrupting timeout).

## Building flexibility into BPMN models

- Use **catching events** (message/condition/timer) as triggers for flexible behavior.
- Use **boundary events** to add work
  - **Non-interrupting** = do extra work while the main work continues.
  - **Interrupting** = stop the main work and take an alternate path.
- Use **boundary events on subprocesses** to widen/clarify the scope where an exception can occur.
- Use **event subprocesses** for “can happen any time” behaviors (status requests, cancellation, etc.).
- Use **escalation events** for controlled “notify parent scope and continue” behavior.
- Use **terminate end events** carefully
  - Terminate cancels the _current scope_ (often a subprocess), not necessarily the whole process instance.

## Situation patterns (reusable modeling solutions)

- **Multi-step escalation (remind → remind → cancel)**
  - For executable Operaton models, favor **receive task + boundary timers** over event-based-gateway loops.
- **Four-eyes principle (two approvers)**
  - Separate tasks (explicit, readable) vs loop (compact) vs multi-instance (parallel speed).
  - Enforce “different approvers” via engine constraints (assignment rules, candidate groups, or custom checks).
- **KPIs and milestones**
  - Use meaningful start/end states.
  - Add intermediate milestones or subprocess “phases” to make measurement points explicit.
- **Decisions in processes**
  - Don’t model decision trees with many gateways.
  - Model one “Decide …” step (often a business rule task calling DMN), then branch on its result.
- **First come, first serve (ask many, accept first reply)**
  - Fan out requests (often multi-instance send/task) and wait for the first correlated reply.
  - Design intentionally for ignoring late responses (and handle them safely at the integration boundary).
- **Batch processing (1-to-n)**
  - Collect items into a data store/state, then run a periodic/batch process that iterates via multi-instance.
- **Prevent concurrent duplicate work**
  - Prefer coordination via messages/state (“one active checker informs waiting instances”) over polling with timers.

## Technically relevant IDs (for executable models)

- Assign meaningful IDs to process, tasks, gateways, flows with conditions, messages, and errors.
- Use consistent prefixes (example): `Process_`, `Task_`, `Gateway_`, `SequenceFlow_`, `Message_`, `Error_`.
- Change IDs in the modeler UI (not by editing BPMN XML) to avoid breaking DI references.
- Align BPMN filename with the process definition key (process `id`).
- Consider generating constants (for tests/integration code) from BPMN/DMN files.

## DMN: choosing a hit policy

- Pick a hit policy that matches your intent:
  - **Unique**: mutually exclusive rules; good for “complete partition” style tables.
  - **First**: ordered overrides (top-to-bottom); good for “hard exclusions first”.
  - **Any**: overlap allowed only if outputs are identical.
  - **Collect**: independent rules producing a set/list (e.g., eligible groups).
  - **Collect + Sum**: scoring models (“soft criteria”).
- Avoid accidental overlap: if rules can overlap, make it explicit via the hit policy and add tests.
- Prefer a final “else”/catch-all rule when you need completeness.
- Verify which hit policies your Operaton/DMN engine version supports and lock behavior with automated tests.

## Version binding for called resources (Camunda 7 / Operaton adaptation)

Camunda 7 already provides binding concepts for called processes/decisions.

- **Call Activity (BPMN)**: use `camunda:calledElementBinding`:
  - `latest`: resolves the newest deployed definition by key at activation time (fast iteration; riskier in prod).
  - `deployment`: resolves a definition deployed together with the calling process (predictable behavior).
  - `version`: pin to a specific version (requires managing version numbers explicitly).
- **Business Rule Task (DMN)**: use `camunda:decisionRefBinding` with similar options (`latest` / `deployment` / `version`).
- Recommended default for production stability: prefer **`deployment`** (or a pinned version) for shared dependencies; use `latest` mainly for development or when you can guarantee backward compatibility.

## Operational notes (engine-friendly modeling)

- Avoid modeling “retry loops” in BPMN for technical failures.
  - In Operaton, prefer engine-level mechanisms (job retries/incidents) and worker-side retry/backoff for external tasks.
  - Keep BPMN focused on business-level exception handling.

## Loopback / review-and-rework patterns

A common pattern is **Task → Review → Gateway → (Yes: continue) / (No: loop back to Task)**. This models "go back and edit" flows for human review cycles.

**Recommended structure:**

```
[Enter Details] → [Review & Confirm] → <Confirmed?> -Yes→ [Next Step] → (End)
                                             |
                                             No (loopback to Enter Details)
```

**Layout guidance:**

- Keep the **happy path** (Yes branch) straight and horizontal — it should flow left-to-right without vertical detours.
- Route the **loopback** (No branch) **below** the main path with a clean U-shape: down → left → up. This keeps the loopback visually distinct.
- Use `set_bpmn_connection_waypoints` to manually set clean U-shaped waypoints when the auto-router creates zigzag paths.
- When inserting a gateway into an existing straight flow, use `insert_bpmn_element` — it preserves horizontal alignment between source, gateway, and target.

**Modeling tips:**

- Consider adding a rework annotation or intermediate task on the No-path (e.g., "Rework details") for clearer readability when the business process allows it.
- Loopback to the first user task is fine for simple "go back and edit" flows. For complex multi-step forms, consider using a subprocess with an error boundary event instead.
- Label the gateway as a question (e.g., "Confirmed?", "Details correct?") and the outgoing flows as answers ("Yes" / "No").

## Pool and lane sizing

**Pool dimensions:**

- Default pool width of 600px is too small for most processes. Scale by element count: `max(1200, elementCount × 150)`.
- Pool height should accommodate all lanes with margins: `laneCount × 250` is a good starting point.
- For collaboration diagrams with message flows, allow extra vertical space (≥200px) between pools.
- Collapsed pools (non-executable partner pools) should be ~120px tall — just a thin bar.

**Lane dimensions:**

- Lane height should fit all assigned elements with breathing room: `max(250, ceil(elementsInLane / 4) × 150)`.
- Keep lane heights roughly proportional to their element count — empty lanes look awkward at 250px when neighbors are 600px.
- After assigning elements and running layout, use `move_bpmn_element` to resize pools/lanes that are too tight.

**Sizing workflow:**

1. Build the process flow first (tasks, gateways, events, connections).
2. Wrap in a collaboration (`wrap_bpmn_process_in_collaboration`) with a generous participant width (e.g., 1500px).
3. Create lanes (`create_bpmn_lanes`) and assign elements.
4. Run `layout_bpmn_diagram` — this positions elements within lanes.
5. If elements overflow, resize the participant with `move_bpmn_element` (set `width`/`height`).
6. Run `validate_bpmn_diagram` — the `pool-size-insufficient` rule warns when pools are too small.

## Troubleshooting common issues

**Elements extend beyond the pool or lane boundaries:**

- Run `validate_bpmn_diagram` — the `elements-outside-participant-bounds` rule detects this.
- Use `move_bpmn_element` with `width`/`height` to resize the participant or lane.
- Re-run `layout_bpmn_diagram` after resizing to reposition elements within the new bounds.

**Message flows create visual clutter with long diagonal crossings:**

- Reorder pools to minimise message-flow crossings (place frequently-communicating pools adjacent).
- Use `align_bpmn_elements` to vertically align paired send/receive tasks at the same X coordinate.
- For complex collaborations, collapse non-executable pools (set `collapsed: true`) — they become thin bars.

**Layout produces zigzag cross-lane flows:**

- Check `validate_bpmn_lane_organization` — it reports a lane coherence score and suggests element re-assignments.
- Move tasks that cause excessive lane crossings into the same lane as their neighbours.
- Run `suggest_bpmn_lane_organization` for AI-assisted lane assignment recommendations.
- Consider whether lanes are the right structure — if roles interleave heavily, a flat process (no lanes) may be clearer.

**Duplicate DI shapes or missing shapes after modifications:**

- This is handled automatically — `export_bpmn` deduplicates DI elements before export.
- The `missing-di-shape` bpmnlint rule catches elements without visual representation.
- Running `layout_bpmn_diagram` auto-repairs missing DI shapes.

**Inserted element lands in the wrong lane:**

- When `insert_bpmn_element` splits a cross-lane flow, the new element is placed at the midpoint between source and target, which may fall into an unrelated lane.
- After insertion, use `assign_bpmn_elements_to_lane` to move the element to the correct lane.
- Alternatively, use `add_bpmn_element` with explicit `x`/`y` coordinates followed by manual connection.
