# ADR-028: Fold set_bpmn_event_definition into set_bpmn_element_properties

## Status

Accepted. Implements candidate #2 of [#23](https://github.com/datakurre/bpmn-js-mcp/issues/23)
("Merge remaining overlapping tools"), following the same no-hidden-alias
policy [ADR-027](ADR-027-get-properties-folded-into-list-elements.md)
established for candidate #3.

## Context

`set_bpmn_event_definition` sets or replaces the event definition (timer,
error, message, signal, escalation, conditional, link, terminate,
compensate, cancel) on an event element — `elementId` plus
`eventDefinitionType`/`properties`/`errorRef`/`messageRef`/`signalRef`/
`escalationRef`/`inMappings`. This is the same shape as the five Camunda
sub-objects ADR-021 already folded into `set_bpmn_element_properties`
(`inputOutput`, `formData`, `listeners`, `callActivityVariables`, `loop`):
one element, one concern, no reason to keep it as a separate top-level tool
once that facade pattern exists. `add_bpmn_element` already has its own
independent `eventDefinitionType` shorthand for setting a definition at
creation time (unrelated to this merge, unchanged) by calling
`handleSetEventDefinition` internally.

## Decision

1. Add an `eventDefinition` sub-object to `set_bpmn_element_properties`,
   mirroring `set_bpmn_event_definition`'s own parameters (minus
   `diagramId`/`elementId`, already top-level). The schema fragment is
   extracted into an exported `EVENT_DEFINITION_SCHEMA_PROPERTIES` constant
   in `set-event-definition.ts`, the same pattern the other five sub-objects
   already use for their schema fragments (e.g.
   `IO_PARAMETERS_SCHEMA_PROPERTIES`).
2. `set-event-definition.ts`'s mutation logic is split into a synchronous
   `applySetEventDefinitionCore(diagram, elementId, args)` (the actual
   `moddle`/`modeling` work, no XML sync or lint) plus an
   `assertEventDefinitionTarget(effectiveType, elementId)` predicate (must be
   an event element) — the same `*Core`/`assert*Target` split ADR-026
   established for the other sub-objects, letting `set-properties.ts` apply
   `eventDefinition` alongside the rest inside its `updates[]` batch's single
   compound command.
3. **`set_bpmn_event_definition` is removed outright, not kept as a hidden
   alias** — same rationale and mechanism as ADR-027: no external users
   depend on the old name, so its `TOOL_REGISTRY` entry, `TOOL_DEFINITION`
   (the whole `set-event-definition-schema.ts` file is deleted), and every
   reference in `IDEMPOTENT_TOOLS`/`TOOL_TITLES` are removed; calling the old
   name now gets "Unknown tool". `handleSetEventDefinition` itself stays as a
   plain exported (non-tool) function — the same "internal-only handler"
   pattern as `handleGetProperties`/`handleReplaceElement`/etc. — since
   `add-element-response.ts` calls it directly for the `add_bpmn_element`
   shorthand, and ~16 existing test files call it directly.
4. Every agent-visible reference to the old tool name is updated to point at
   `set_bpmn_element_properties`'s `eventDefinition` sub-object instead:
   `add_bpmn_element`'s own schema description, `manage_bpmn_root_elements`'s
   schema description, the `nextSteps` hints built in `helpers.ts`, the fix
   suggestions in `lint-suggestions.ts` (including the structured
   `fixToolCall` templates in `validate.ts`, whose `args` shape had to change
   from flat `{ eventDefinitionType, properties }` to nested
   `{ eventDefinition: { eventDefinitionType, properties } }` to stay
   directly usable), the bpmnlint rule messages in
   `timer-missing-definition.ts`/`event-subprocess-missing-trigger.ts`/
   `unpaired-link-event.ts`, and the modeling-elements resource guide.
   `test/agent-visible-tool-names.test.ts` catches any of these left stale.

## Consequences

- `TOOL_DEFINITIONS` count: 24 → 23. `ALL_DISPATCHABLE_TOOL_NAMES` count:
  29 → 28 (a real removal, not a hidden alias).
- No functionality loss: every parameter `set_bpmn_event_definition` accepted
  is available through `set_bpmn_element_properties`'s `eventDefinition`
  sub-object with an identical shape, and it composes with `properties` and
  the other sub-objects in one call (and inside `updates[]` batches).
- Net tool-definitions byte budget effect is a reduction: removing the old
  tool's own `name`/`description`/`inputSchema`/`annotations` costs more
  bytes than the `eventDefinition` sub-object schema adds (top-level fragment
  reused verbatim; the `updates[]` per-item schema uses the same lean,
  description-free pattern the other sub-objects use there).
- Items #1 (`add_bpmn_element` + `add_bpmn_element_chain` merge), #4
  (`import_bpmn_xml` folded into `create_bpmn_diagram`), and #5 (lane tool
  split) from #23 remain follow-ups.
