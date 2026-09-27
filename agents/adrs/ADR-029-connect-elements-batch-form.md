# ADR-029: connect_bpmn_elements `connections[]` Batch Form

## Status

Accepted.

## Context

[ADR-026](ADR-026-multi-element-batch-forms.md) added `updates[]` to
`set_bpmn_element_properties` and `moves[]` to `move_bpmn_element`, but
explicitly left `connect_bpmn_elements` as a follow-up (item #2 of #22).
`connect_bpmn_elements` already has a chain mode (`elementIds`) for
sequential connections, but no way to connect arbitrary pairs in one call.
A gateway fan-out — several branches, each with its own condition
expression, plus a default flow — needs one `connect_bpmn_elements` call
per branch today.

## Decision

1. Add an optional `connections: [{ sourceElementId, targetElementId,
label?, connectionType?, conditionExpression?, isDefault? }]` array to
   `connect_bpmn_elements`, a third mode alongside pair mode and chain mode.
   `handleConnect` dispatches to the new `handleConnectBatch` before falling
   through to chain/pair mode.
2. **Validate every item before applying any of them**, the same
   `preValidate*Item` idiom ADR-026 established: each item's source and
   target must exist, and the source must not be a `bpmn:EndEvent` (a flow
   sink). Deeper semantic errors that require actually resolving the
   connection type — e.g. a `bpmn:MessageFlow` requested between two
   elements in the same participant — are still only caught while applying
   the batch, same tradeoff ADR-026 accepts for `updates[]`.
3. **Apply the batch as one undo step.** `connectPair` (the pair-mode
   connection creation + property application) and the duplicate-flow
   lookup are exported from `connect.ts` for reuse. `connect-batch.ts`
   registers a `bpmn-mcp.applyElementConnections` command whose `preExecute`
   calls `applyConnectionItemCore` for every item in one synchronous pass, so
   diagram-js's command stack groups the whole batch (and the wrapper
   command itself) under one undo step, exactly as `move-element-batch.ts`
   does for `moves[]`.
4. **`preExecute` must never throw** (ADR-026 point 4): errors are stashed on
   the context and the caller unwinds every change via a `commandStack.undo()`
   loop back to the pre-batch stack index before throwing a clean error
   naming the failing item.
5. **Duplicate pairs are skipped, not errors**, matching pair mode's existing
   dedup guard: a `connections[]` item whose source→target sequence flow
   already exists returns `{ skipped: true, connectionId: <existing> }`
   instead of creating a second flow or failing the whole batch.
6. The response stays compact: one entry per item (`sourceElementId`,
   `targetElementId`, `connectionId`, `connectionType`, optional `skipped`/
   `warning`), a deduplicated `hint` set (e.g. parallel-gateway-balance
   warnings, cross-pool auto-corrections), and a single `appendLintFeedback`
   call for the whole batch.

## Consequences

- A gateway's branches (conditions, default flow) can be created in one
  call and one undo step instead of one call per branch.
- `connect.ts` grew three small exports (`connectPair`,
  `findDuplicateFlowId`, `detectImplicitMergeWarning`, `buildPairConnectHints`)
  purely for reuse by `connect-batch.ts`; pair mode and chain mode's own
  behavior and tests are unchanged.
- `get_bpmn_element_properties`'s plural form (item #3 of #22) was already
  addressed by folding it into `list_bpmn_elements`'s `elementIds` mode
  ([ADR-027](ADR-027-get-properties-folded-into-list-elements.md)). With this
  ADR, all four items of #22's plural-forms proposal are done.
