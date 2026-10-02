# ADR-032 — add_bpmn_element_chain folded into add_bpmn_element

## Status

Accepted (#23 item 1)

## Context

`add_bpmn_element_chain` was "add several elements and connect them in order",
with `add_bpmn_element` as its one-element case. Two tools, two overlapping
schemas.

## Decision

- `add_bpmn_element` accepts `elements: [...]` (instead of `elementType`) with
  `connect: 'chain' | 'none'` (default `chain`) and `autoLayout`. Top-level
  `afterElementId`, `participantId` and `laneId` apply to all entries; entries
  carry `elementType`, `name`, `participantId`, `laneId`, `x`, `y`, `isExpanded`
  and the event-definition shorthands.
- The singular name is kept (no churn), following ADR-026..030.
- `elements` combined with any other single-element parameter is rejected with
  `illegalCombinationError`; the schema requires `elementType` or `elements`.
- `add_bpmn_element_chain` is removed outright (no hidden alias), including its
  `core`-tier slot. The handler remains internal (`handleAddElementChain`).
- The routing lives in `add-element-tool.ts`; `handleAddElement` stays the
  single-element handler used internally (e.g. by handoff).
- Entries accept the full single-element parameter set (except `diagramId`) and
  any `bpmn:` element type the single form allows, so an entry can be a boundary
  event (`hostElementId`), a flow insertion (`flowId`), a handoff
  (`fromElementId` + `toLaneId`), a copy (`copyFrom`) or explicitly positioned
  (`x`/`y`). Unknown entry keys are rejected with `illegalCombinationError`.
- An entry that sets its own anchor or position is placed there instead of being
  chained after the previous element, and auto-layout then defaults to off (it
  would discard the placement) unless `autoLayout: true` is passed.
- With `connect: 'none'`, entries without their own anchor are placed right of
  the previous one (starting from `afterElementId`) without connecting.
