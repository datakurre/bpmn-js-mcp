# ADR-032 — add_bpmn_element and add_bpmn_element_chain merged into add_bpmn_elements

## Status

Accepted (#23 item 1)

## Context

`add_bpmn_element_chain` was "add several elements and connect them in order",
with `add_bpmn_element` as its one-element case. Two tools, two overlapping
schemas, and `add_bpmn_element` was the largest schema in the server.

## Decision

- One tool, `add_bpmn_elements`, replaces both. `elements` is always an array
  (a single element is an array of one); there is no single-element form and no
  alias for either old name (calling them is an "Unknown tool" error).
- Each entry takes the full per-element parameter set (`elementType`, `name`,
  `x`/`y`, `hostElementId`, `flowId`, `fromElementId` + `toLaneId`, `copyFrom`,
  `parentId`, event shorthands, ...) and any element type the old tool allowed.
  Unknown entry keys are rejected with `illegalCombinationError`; per-element
  options at the top level are rejected too. Top-level arguments: `diagramId`,
  `elements`, `connect`, `autoLayout`, and the defaults `afterElementId`,
  `participantId`, `laneId`.
- `connect: 'chain'` (default) connects each entry to the previous one by a
  sequence flow (not past a gateway) and lays the diagram out; `connect: 'none'`
  only adds, placing each entry right of the previous one (from `afterElementId`).
- An entry that sets its own anchor or position (`hostElementId`, `flowId`,
  handoff, `copyFrom`, `afterElementId`, `x`/`y`) is placed there instead of being
  chained; auto-layout then defaults to off (it would discard the placement)
  unless `autoLayout: true`.
- Internally `handleAddElement` stays the single-element handler (called per
  entry, and by tests), `handleAddElementChain` is the `add_bpmn_elements`
  handler core, and `add-elements.ts` validates the call shape and defines the
  tool. The per-entry schema lives in `add-element-schema.ts`.
- Agent-visible references (hints, lint fix suggestions, `validate_bpmn_diagram`'s
  `fixToolCall` templates, prompts, guides, docs) point at `add_bpmn_elements`;
  `fixToolCall` args are `{ elements: [{...}] }`.
