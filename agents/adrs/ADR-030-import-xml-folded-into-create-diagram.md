# ADR-030: import_bpmn_xml Folded into create_bpmn_diagram

## Status

Accepted.

## Context

This is candidate #4 of [#23](https://github.com/datakurre/bpmn-js-mcp/issues/23):
`create_bpmn_diagram` already supports a `cloneFrom` source (duplicate an
existing in-memory diagram) alongside its default blank-diagram behavior,
and shares `draftMode`/`hintLevel` with `import_bpmn_xml`. Both tools do the
same thing — produce a new diagram ID and store a fresh modeler — differing
only in how the initial content is obtained. Per #23's updated policy (see
[ADR-027](ADR-027-get-properties-folded-into-list-elements.md)), the merge
removes `import_bpmn_xml` outright rather than keeping it as a hidden alias.

## Decision

1. `create_bpmn_diagram` gains `xml`/`filePath` (+ `autoLayout`) as a third
   source, alongside blank (default) and `cloneFrom`: blank | clone | XML |
   file. `handleCreateDiagram` dispatches to `cloneDiagram` (unchanged) when
   `cloneFrom` is given, to the new `importDiagram` helper when `xml` or
   `filePath` is given, and otherwise builds a blank diagram as before.
2. `importDiagram` is a thin one-line wrapper that forwards to
   `handleImportXml` (unchanged internals — XML resolution, DI detection,
   conditional auto-layout, modeler creation) with the subset of args that
   apply (`xml`, `filePath`, `autoLayout`, `draftMode`, `hintLevel`).
   `workflowContext`/`includeImage`/`name` are blank-diagram-only concerns
   and are not threaded into the import path, matching import's existing
   scope (it never supported them either).
3. **`import_bpmn_xml` is removed outright**, not kept as a hidden alias:
   its `TOOL_REGISTRY` entry and `TOOL_DEFINITION` are removed, and its
   entries in `OPEN_WORLD_TOOLS`/`TOOL_TITLES` are removed (`create_bpmn_diagram`
   joins `OPEN_WORLD_TOOLS` instead, since it can now read a file via
   `filePath`). Calling `import_bpmn_xml` now gets the normal "Unknown tool"
   error.
4. `handleImportXml` stays a plain exported function in `import-xml.ts`
   (like `handleGetProperties`/`handleSetEventDefinition` in ADR-027/028) —
   `create-diagram.ts` calls it directly, and the ~25 existing test files
   that call it directly to build test fixtures (independent of the tool
   registry) keep working unchanged.

## Consequences

- `create_bpmn_diagram` becomes the single entry point for obtaining a new
  diagram ID, regardless of source. `ALL_DISPATCHABLE_TOOL_NAMES`/
  `TOOL_DEFINITIONS` both drop by one (28 → 27 dispatchable, 23 → 22 listed).
  The `core` tier drops from 12 to 11 tools — no capability lost, since
  `create_bpmn_diagram` (already core-tier) now covers both.
- `handleImportXml`'s own behavior, response shape, and test coverage are
  completely unchanged; only its registration as a standalone tool is
  removed.
- Of #23's five candidates, #2 (ADR-028), #3 (ADR-027), and #4 (this ADR)
  are done. #1 (`add_bpmn_element` + `add_bpmn_element_chain` merge) and #5
  (lane tool split) remain.
