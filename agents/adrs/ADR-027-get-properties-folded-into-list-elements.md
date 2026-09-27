# ADR-027: Fold get_bpmn_element_properties into list_bpmn_elements

## Status

Accepted. Implements candidate #3 of [#23](https://github.com/datakurre/bpmn-js-mcp/issues/23)
("Merge remaining overlapping tools"), which is also item #3 of
[#22](https://github.com/datakurre/bpmn-js-mcp/issues/22)'s plural-forms
proposal.

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
   `buildElementDetail(element)` function, called by both the internal
   `handleGetProperties` (see point 3) and `list_bpmn_elements`'s new
   `elementIds` branch. No detail-serialization logic is duplicated.
3. **`get_bpmn_element_properties` is removed outright, not kept as a
   hidden alias.** Unlike [ADR-021](ADR-021-camunda-setter-consolidation.md)'s
   pattern (`hidden: true` in `TOOL_REGISTRY`, kept dispatchable for one
   release), #23 was updated to drop that requirement for new merges: this
   project has no external users depending on old tool names yet, so a
   hidden alias is dead weight with no compatibility payoff. The
   `TOOL_REGISTRY` entry, the `TOOL_DEFINITION` export, and every
   `get_bpmn_element_properties` reference in `READONLY_TOOLS`/`TOOL_TITLES`/
   server instructions are deleted; calling the old name now gets the
   ordinary "Unknown tool" error, same as any other consolidated-away tool
   (`clone_bpmn_diagram`, `replace_bpmn_element`, etc.). The handler
   function itself, `handleGetProperties`, stays as a plain exported
   function (not a registered tool) — the same "internal-only handler"
   pattern those other removed tools already use — since it is still
   useful directly in tests and costs nothing to keep once it is off the
   MCP tool surface.
4. Unlike the mutating batch forms in [ADR-026](ADR-026-multi-element-batch-forms.md),
   `elementIds` needs no command-stack compound command,
   pre-validation-before-mutation, or rollback path: nothing is mutated, so
   a missing element ID simply throws `Element not found` for that ID (via
   the same `requireElement` the single-element handler already used) and
   the call fails outright — there is no partial state to protect.

## Consequences

- Inspecting several elements (e.g. after a `list_bpmn_elements` search)
  costs one call instead of one per element.
- `TOOL_DEFINITIONS` count: 25 → 24. `ALL_DISPATCHABLE_TOOL_NAMES` count:
  30 → 29 (a real removal, unlike ADR-021's hidden aliases which stayed
  dispatchable and left that count unchanged).
- No functionality loss for the API surface that remains: every property
  `get_bpmn_element_properties` returned is available through
  `list_bpmn_elements`'s `elementIds` mode with an identical shape. A caller
  still using the literal tool name `get_bpmn_element_properties` gets
  "Unknown tool" — this is an intentional breaking change per #23's revised
  no-alias policy, not an oversight.
- Item #2 of #22 (`connect_bpmn_elements` arbitrary-pair `connections`
  array) remains a follow-up; the tool-definitions size budget
  (`test/tool-definitions.test.ts`) has more headroom after this change
  (removing `get_bpmn_element_properties`'s own `name`/`description`/
  `inputSchema`/`annotations` from `TOOL_DEFINITIONS` costs more bytes than
  the small `elementIds` addition to `list_bpmn_elements`'s schema).
