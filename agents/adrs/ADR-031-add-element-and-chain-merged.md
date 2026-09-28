# ADR-031: add_bpmn_element + add_bpmn_element_chain Merged into add_bpmn_elements

## Status

Accepted.

## Context

This is candidate #1 of [#23](https://github.com/datakurre/bpmn-js-mcp/issues/23),
the last remaining structural-tool candidate: `add_bpmn_element_chain` is
already "add several elements and connect them in order", and
`add_bpmn_element` is the one-element case. `add_bpmn_element` was also the
largest tool schema in the server (8.1 KB, 26 parameters), so the issue asked
for a rethink alongside the merge. Per #23's updated policy (ADR-027), the
merge removes both old tools outright rather than keeping a hidden alias.

## Decision

1. A single `add_bpmn_elements` tool replaces both. `elements` is always an
   array — a single element is an array of one — and each item accepts the
   full set of fields `add_bpmn_element` used to accept at its top level
   (`hostElementId`, `flowId`, `eventDefinitionType`, `copyFrom`,
   `fromElementId`/`toLaneId`, etc.), minus `diagramId`.
2. A top-level `connect: 'chain' | 'none'` (default `'chain'`) picks how
   consecutive elements relate:
   - `'chain'`: auto-connect each element to the previous one in sequence
     (the former `add_bpmn_element_chain` behavior) — `handleAddElements`
     delegates straight to `handleAddElementChain`.
   - `'none'`: add every element independently using each item's own
     fields, with no injected `afterElementId` between items — useful for
     a gateway's branches, which share an anchor (the gateway) but must
     not chain to each other. `handleAddElements` loops over the items and
     calls `handleAddElement` per item directly.
3. **`add_bpmn_element_chain`'s per-item field set is broadened** from its
   previous 4 fields (`elementType`/`name`/`participantId`/`laneId`) to the
   full `add_bpmn_element` field set, so a chain item can also be a
   boundary event, a flow insertion, a handoff, a copy, etc. An item that
   sets its own placement anchor (`hostElementId`, `flowId`, a handoff via
   `fromElementId`/`toLaneId`, `copyFrom`, or explicit `x`/`y`) is placed
   there instead of being auto-connected after the previous element, even
   in `'chain'` mode — see `hasOwnAnchor` in `add-element-chain.ts`.
   `validateChainElements`'s per-item type check is broadened from a
   chain-specific subset to the full `ALLOWED_ELEMENT_TYPES` used by
   `add_bpmn_element` (e.g. `bpmn:Participant`, `bpmn:BoundaryEvent` are now
   accepted chain items) — purely additive, since existing chain callers
   only ever set the original 4 fields.
4. **`add_bpmn_element` and `add_bpmn_element_chain` are removed outright**,
   not kept as hidden aliases, per #23's updated policy: their
   `TOOL_REGISTRY` entries and `TOOL_DEFINITION`s (including the now-orphaned
   `add-element-schema.ts`) are deleted, and `TOOL_TITLES` is updated.
   Calling either old name now gets the normal "Unknown tool" error.
5. `handleAddElement` and `handleAddElementChain` stay as plain exported
   functions (same pattern as `handleGetProperties`/`handleSetEventDefinition`/
   `handleImportXml` in ADR-027/028/030) — `add-elements.ts` calls both
   directly, and the ~80 existing test files that call either directly to
   build fixtures keep working unchanged.
6. Every agent-visible reference to the old tool names (nextSteps hints,
   lint fix suggestions in `lint-suggestions.ts` and `validate.ts`'s
   structured `fixToolCall` templates, resource guides, prompts) is updated
   to point at `add_bpmn_elements` instead — `validate.ts`'s `FIX_TOOL_CALLS`
   entries additionally had their `args` rewrapped from flat fields into
   `{ elements: [{...}] }`.

## Consequences

- `ALL_DISPATCHABLE_TOOL_NAMES`: 27 → 26 (two tools removed, one added).
  `TOOL_DEFINITIONS`: 22 → 21 likewise. Net effect on the size budget is a
  reduction: removing both old schemas (8.1 KB + 2.2 KB) and adding the new
  one (~9.8 KB, reusing the same per-item property descriptions once as
  `elements.items.properties` rather than duplicating them) frees roughly
  600 bytes versus before.
- A gateway's branches, or any batch of elements sharing one anchor but not
  chained to each other, can now be added in one call via `connect: 'none'`
  with each item's own `afterElementId`, instead of one `add_bpmn_element`
  call per branch.
- `add_bpmn_element`'s and `add_bpmn_element_chain`'s own behavior,
  response shape, and test coverage are unchanged; only their registration
  as standalone tools is removed, and the chain's accepted per-item field
  set and type list are broadened (backward-compatible with all existing
  narrow-field callers).
- Of #23's five candidates, four are now done: #1 (this ADR), #2 (ADR-028),
  #3 (ADR-027), and #4 (ADR-030). #5 (splitting lane mutation from analysis
  — `create_bpmn_lanes`/`assign_bpmn_elements_to_lane`/`analyze_bpmn_lanes`'s
  `redistribute` mode) remains.
