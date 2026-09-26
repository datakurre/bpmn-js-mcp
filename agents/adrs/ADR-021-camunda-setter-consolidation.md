# ADR-021: Consolidate the Camunda Property Setters into set_bpmn_element_properties

## Status

Accepted. Supersedes the part of [ADR-005](ADR-005-canonical-loop-tool.md) that
makes `set_bpmn_loop_characteristics` the canonical, standalone entry point for
loop characteristics — it is now canonical as the `loop` sub-object of
`set_bpmn_element_properties`, with the standalone tool kept only as a hidden
alias (see Decision).

## Context

Five registered tools each set one Camunda extension-element concern on a
single element:

- `set_bpmn_input_output_mapping` (camunda:InputOutput)
- `set_bpmn_form_data` (camunda:FormData)
- `set_bpmn_camunda_listeners` (execution/task listeners, error definitions)
- `set_bpmn_call_activity_variables` (camunda:In / camunda:Out)
- `set_bpmn_loop_characteristics` (standard loops, multi-instance)

`set_bpmn_element_properties` already sets arbitrary `camunda:*` attributes
and, since an earlier consolidation, also replaces the element type
(`elementType`). Keeping five more single-purpose tools registered:

- adds five entries an AI caller has to read and choose between, on top of
  the already-large tool list (see #6),
- forces a caller that wants to configure e.g. a UserTask's form fields
  _and_ its listeners to make two round trips instead of one,
- duplicates schema and dispatch boilerplate for tools that are otherwise
  thin wrappers around a single moddle extension-element shape.

## Decision

1. Add five optional sub-objects to `set_bpmn_element_properties`:
   `inputOutput`, `formData`, `listeners`, `callActivityVariables`, `loop`.
   Each mirrors the removed tool's own parameters (minus `diagramId`/
   `elementId`, which are already top-level). The schema for each sub-object
   is the same JSON Schema fragment used by the original tool — extracted
   into a shared exported constant (e.g. `IO_PARAMETERS_SCHEMA_PROPERTIES` in
   `set-input-output.ts`) so there is exactly one copy of each shape, reused
   by both the (now hidden) original tool and the new sub-object.
2. `handleSetProperties` delegates each present sub-object to its existing
   handler function (`handleSetInputOutput`, `handleSetFormData`,
   `handleSetCamundaListeners`, `handleSetCallActivityVariables`,
   `handleSetLoopCharacteristics`) — no BPMN-modeling logic is duplicated.
   Multiple sub-objects (and `properties`/`elementType`) can be set in one
   call; the response merges each section's summary and `nextSteps` under a
   `sections` key.
3. The five original tools are **unregistered from `TOOL_DEFINITIONS`**
   (so they no longer appear in `ListTools`) but stay **fully dispatchable**
   — `TOOL_REGISTRY` entries gain a `hidden: true` flag that
   `TOOL_DEFINITIONS` filters out while the dispatch map (built from the full
   registry) keeps routing calls to them. This is a hidden alias kept for one
   release so prompts, scripts, or cached tool lists written against the old
   names keep working; a later release can drop the flag and delete the
   handler files once nothing depends on the standalone names.

## Consequences

- Tool count: 30 → 25 (five hidden aliases removed from the visible list).
- `set_bpmn_element_properties`'s own schema grows (it now carries five
  sub-objects), but the net serialized tool list still shrinks, since the
  five separate tools' `name`/`description`/`annotations` wrapper overhead
  (repeated per tool) disappears along with their duplicated top-level
  `diagramId`/`elementId` properties.
- No functionality loss: every capability previously exposed via the five
  tools is available either through the standalone (now hidden) tool name
  or through `set_bpmn_element_properties`'s matching sub-object.
- `test/tool-definitions.test.ts` and `test/handlers/core/batch-dispatch.test.ts`
  assert both facts explicitly: the five names are absent from
  `TOOL_DEFINITIONS` but still resolve through `dispatchToolCall` (no
  "Unknown tool"), and `test/agent-visible-tool-names.test.ts` treats a
  "former X tool" mention of a hidden alias as accurate, not stale.
