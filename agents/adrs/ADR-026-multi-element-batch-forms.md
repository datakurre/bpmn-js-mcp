# ADR-026: Multi-Element Batch Forms (set_bpmn_element_properties, move_bpmn_element)

## Status

Accepted.

## Context

`set_bpmn_element_properties` (and its `elementType`/`inputOutput`/`formData`/
`listeners`/`callActivityVariables`/`loop` sub-objects, see
[ADR-021](ADR-021-camunda-setter-consolidation.md)) acts on exactly one
element per call. Common tasks — e.g. making a process executable by setting
`camunda:assignee` on every UserTask, or adding form data to several tasks —
need one call per element. `batch_bpmn_operations` can already group calls,
but it repeats the tool name and `diagramId` per operation, and does not
group the underlying `modeling` mutations into a single undo step.

This is the first (and biggest-win, per the issue) item of the plural-forms
proposal: a `set_bpmn_element_properties` call currently configuring one
element's assignee, form, and listeners in one round trip cannot do the same
for five elements without five round trips.

## Decision

1. Add an optional `updates: [{ elementId, properties?, elementType?,
inputOutput?, formData?, listeners?, callActivityVariables?, loop? }]`
   array to `set_bpmn_element_properties`, alternative to the single-element
   `elementId` (+ concern) fields. `elementId` becomes optional at the
   top level; `handleSetProperties` is a thin dispatcher that routes to either
   `handleSetPropertiesSingle` (existing behaviour, unchanged) or the new
   `handleSetPropertiesBatch`.
2. **Validate every item before applying any of them.** `preValidateUpdateItem`
   checks, per item and without mutating anything: the element exists, at
   least one concern is present, `elementType` (if given) is a legal
   replacement, and every requested sub-object's target-type constraint
   (e.g. `formData` needs a UserTask/StartEvent) is satisfied by the
   element's effective type (the post-`elementType` type when one is given).
   These checks reuse small `assert*Target(effectiveType, elementId)`
   predicates now exported alongside each sub-object's Core mutator (see
   point 3) — the same predicates the mutation path itself uses — so
   validation and mutation cannot silently disagree.
3. **Apply the batch as one undo step.** Each of `replace-element.ts` and the
   five sub-object handlers (`set-input-output.ts`, `set-form-data.ts`,
   `set-camunda-listeners.ts`, `set-call-activity-variables.ts`,
   `set-loop-characteristics.ts`) is split into a synchronous `*Core`
   function (the actual `modeling`/moddle mutation, no XML sync, no lint) and
   a thin async handler (`requireDiagram` → `*Core` → `syncXml` →
   `jsonResult` → `appendLintFeedback`), used unchanged by the existing
   single-element tools. `handleSetPropertiesBatch` registers a
   `bpmn-mcp.applyPropertyUpdates` command (the same technique
   `auto-layout.ts` uses for `layout_bpmn_diagram`) whose `preExecute` calls
   every item's `*Core` functions in one synchronous pass. Because every
   nested `modeling`/`bpmnReplace` call happens inside that one call frame,
   diagram-js's command stack groups them — and the wrapper command itself —
   under a single id, so `bpmn_history` undoes/redoes the whole batch in one
   step.
4. **`preExecute` must never throw.** diagram-js's `CommandStack.execute()`
   has no exception handling around `preExecute`: an uncaught throw there
   leaves its internal action-nesting bookkeeping permanently corrupted for
   the rest of that diagram's session. `ensureBatchUpdateCommand`'s
   `preExecute` therefore catches internally and stashes the error on the
   context instead of rethrowing. `handleSetPropertiesBatch` checks that
   field after `commandStack.execute()` returns and, if set, unwinds every
   change the batch made via a `commandStack.undo()` loop back to the
   pre-batch stack index (the same rollback idiom `batch_bpmn_operations`
   uses) before throwing a clean error naming the failing item. Combined with
   point 2's thorough pre-validation, this path should only trigger for
   genuinely unexpected failures.
5. The response stays compact: one entry per item (`elementId`, optional
   `originalElementId` when `elementType` changed it, `changed: [...]`), a
   merged/deduped `nextSteps`, and a single `appendLintFeedback` call for the
   whole batch — not one per item.

## Consequences

- Configuring N elements' properties/sub-objects now costs one tool call and
  one undo step instead of N of each.
- The five sub-object handlers and `replace_bpmn_element` gain an exported
  `*Core`/`replaceElementCore` function and (for the four with type
  constraints) an exported `assert*Target` predicate; their existing async
  handlers and public behaviour are unchanged (covered by the existing
  per-handler test suites, unmodified by this change).
- `updates[]` intentionally does not attempt to pre-validate every possible
  mutation failure (e.g. a missing required field inside a sub-object is
  still only caught by that sub-object's own `*Core`, mid-batch) — the
  catch-and-rollback path in point 4 makes that degrade safely to "nothing
  applied" rather than a partially-applied diagram, at the cost of an extra
  undo pass in that rarer case.
- `connect_bpmn_elements` and `get_bpmn_element_properties` plural forms
  (items #2 and #3 of the proposal) are follow-ups, not covered here — see
  [ADR-027](ADR-027-get-properties-folded-into-list-elements.md) and
  [ADR-029](ADR-029-connect-elements-batch-form.md).

## Follow-up: move_bpmn_element's `moves` array

The same pattern (validate every item up front, apply the whole batch inside
one command-stack `preExecute`, catch-don't-throw + undo-loop rollback on
failure) is applied to `move_bpmn_element` (item #4 of the proposal):

- An optional `moves: [{ elementId, x?, y?, width?, height?, laneId? }]`
  array is added, alternative to the single-element `elementId` (+ x/y/
  width/height/laneId) fields. `handleMoveElement` dispatches to either the
  existing `handleMoveElementSingle` (unchanged behaviour) or
  `handleMoveElementBatch`.
- The single-element move/resize/relane logic is extracted into a
  synchronous `applyMoveItemCore`, reused by both paths — mirroring the
  `*Core` split point 3 above describes for the property setters.
- Pre-validation is simpler than the property-setters case: an element move
  has no sub-object type matrix, just "the element exists", "at least one of
  x/y/width/height/laneId is given", and (when `laneId` is given) "the lane
  exists and is a `bpmn:Lane`" — all cheap, non-mutating checks against the
  element registry.
- The batch-only code (`ensureBatchMoveCommand`, `preValidateMoveItem`,
  `handleMoveElementBatch`) lives in a new `move-element-batch.ts` file
  rather than inline in `move-element.ts`, to stay under the project's
  per-file `max-lines` budget (`move-element.ts` is not on the exemption
  list in `eslint.config.mjs` the way `set-properties.ts` is).
- Unlike the property-setters' response (which lists what changed per
  element), the moves response only needs `{ elementId, actions }` per item
  since there are no sub-objects to enumerate.
