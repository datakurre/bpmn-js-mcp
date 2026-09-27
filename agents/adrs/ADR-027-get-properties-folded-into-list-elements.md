# ADR-027: Fold get_bpmn_element_properties into list_bpmn_elements

## Status

Accepted. Implements candidate #3 of [#23](https://github.com/datakurre/bpmn-js-mcp/issues/23)
("Merge remaining overlapping tools"), which is also item #3 of
[#22](https://github.com/datakurre/bpmn-js-mcp/issues/22)'s plural-forms
proposal. Follows the same `hidden: true` alias pattern as
[ADR-021](ADR-021-camunda-setter-consolidation.md).

## Context

`list_bpmn_elements` and `get_bpmn_element_properties` are both read-only
element inspection tools: the former finds elements (optionally filtered by
name/type/property) and returns a compact summary per element; the latter
takes one `elementId` and returns the full property detail (Camunda
extension properties, extension elements, connections, event definitions).
Together they force two separate calls for "search, then inspect what I
found" and one call per element to inspect several elements — with no
sub-object matrix or mutation to worry about (both are pure reads), it is a
much smaller version of the same "single-target tool costs one call per
element" problem #22 tracks.

## Decision

1. `list_bpmn_elements` gains an optional `elementIds: string[]` parameter.
   When provided, it ignores `namePattern`/`elementType`/`property`/`inline`
   and instead returns the full property-detail object (the same shape
   `get_bpmn_element_properties` produced) for each listed ID — covering
   both "find" and "inspect", including inspecting several elements in one
   call.
2. The detail-building logic (standard attributes, Camunda extension
   properties, extension elements, connections, event definitions) is
   extracted from `get-properties.ts`'s handler into an exported
   `buildElementDetail(element)` function, called by both the single-element
   `get_bpmn_element_properties` handler (unchanged behaviour, now used only
   via the hidden alias) and `list_bpmn_elements`'s new `elementIds` branch.
   No detail-serialization logic is duplicated.
3. `get_bpmn_element_properties` is unregistered from `TOOL_DEFINITIONS` (the
   `hidden: true` flag on its `TOOL_REGISTRY` entry) but stays fully
   dispatchable, kept for one release so existing prompts/scripts against the
   old name keep working (same rationale as ADR-021). It stays in
   `READONLY_TOOLS` since dispatch-time behaviour (e.g. the MCP Apps view
   exclusion check) doesn't depend on `ListTools` visibility.
4. Unlike the mutating batch forms in ADR-026, `elementIds` needs no
   command-stack compound command, pre-validation-before-mutation, or
   rollback path: nothing is mutated, so a missing element ID simply throws
   `Element not found` for that ID (via the same `requireElement` the
   single-element tool already used) and the call fails outright — there is
   no partial state to protect.

## Consequences

- Inspecting several elements (e.g. after a `list_bpmn_elements` search)
  costs one call instead of one per element.
- `TOOL_DEFINITIONS` count: 25 → 24.
- No functionality loss: `get_bpmn_element_properties` still works
  identically as a hidden alias, and its output shape is unchanged.
- Item #2 of #22 (`connect_bpmn_elements` arbitrary-pair `connections`
  array) remains a follow-up; the tool-definitions size budget
  (`test/tool-definitions.test.ts`) has more headroom after this change
  (removing `get_bpmn_element_properties`'s own `name`/`description`/
  `inputSchema`/`annotations` from `TOOL_DEFINITIONS` costs more bytes than
  the small `elementIds` addition to `list_bpmn_elements`'s schema).
