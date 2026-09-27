# ADR-023: Resource Links Instead of Inlining Large Output

## Status

Accepted

## Context

`export_bpmn` (xml/svg/both), `list_bpmn_elements`, and
`list_bpmn_process_variables` always inlined their full output as tool-result
text. For a small diagram — the common case AI callers build incrementally —
that's fine. For a large, already-built diagram (imported from a real
deployment, or after many edits), a single `export_bpmn` call could inline
tens of thousands of characters of XML/SVG, and `list_bpmn_elements`/
`list_bpmn_process_variables` could inline hundreds of entries, even though
the same content is already available on demand via the `bpmn://diagram/{id}/xml`,
`/svg`, `/elements`, and `/variables` resources (`src/resources.ts`).

## Decision

1. **Size/count thresholds, not an unconditional default flip.** `export_bpmn`
   summarizes xml content beyond `LARGE_XML_CHARS` (20,000 characters) and
   svg content beyond `LARGE_SVG_CHARS` (100,000 characters — SVG runs
   roughly 3-4x more verbose per element than XML, so a single shared
   threshold was miscalibrated: a plain ~20-element, 3-lane diagram already
   produces 20,000-30,000 characters of SVG, which is not "large" by any
   reasonable definition, but tripped a single 20,000-character cutoff in
   the layout-scenario tests during development);
   `list_bpmn_elements`/`list_bpmn_process_variables` summarize beyond
   `LARGE_LIST_COUNT` (60 entries) — all in `src/constants.ts`. Below the
   threshold, behavior is unchanged (full inline content), so the existing
   test suite's small diagrams are unaffected — this was a deliberate choice
   over unconditionally changing the default for every call without
   `filePath`/filters, which would have broken ~120 existing direct
   `handleExportBpmn` call sites across the test suite.
2. **`export_bpmn`**: a summarized text item is replaced with a
   `{ type: 'resource_link', uri: 'bpmn://diagram/{id}/xml' | '/svg', name, description, mimeType }`
   content item; for `format: 'both'` each of xml/svg is evaluated
   independently against the threshold. Pass `inline: true` to force full
   text regardless of size. A `filePath` write always gets the full,
   unsummarized content — only what's _returned_ to the caller is affected.
3. **`list_bpmn_elements`**: an unfiltered call beyond the threshold returns
   `{ success, count, summaryByType, resource, message }` (a per-type element
   count, not the full array) as its `content[0]` JSON text, **plus** an
   additional `resource_link` content item pointing at
   `bpmn://diagram/{id}/elements`. A _filtered_ call (`namePattern`,
   `elementType`, or `property`) always returns in full — filters are
   already a deliberate, narrowed ask. Pass `inline: true` to force the full
   array regardless of size.
4. **`list_bpmn_process_variables`**: beyond the threshold, returns variable
   _names_ only (`names: string[]`) instead of the full
   `{ name, readBy, writtenBy }` detail per variable, plus the same
   `resource_link` pattern pointing at `bpmn://diagram/{id}/variables`. Pass
   `inline: true` to force full detail.
5. **New `bpmn://diagram/{id}/svg` resource** (mirrors the existing `/xml`
   one), added to `RESOURCE_TEMPLATES`/`listResources()`/`readResource()` in
   `src/resources.ts`, computed the same way as `export_bpmn`'s `svg` format
   (`adjustSvgViewBox`, shared from `export-helpers.ts`).
6. **Additive content, not a replaced shape.** The JSON summary for
   list*bpmn_elements/list_bpmn_process_variables is still a single
   `content[0]` text/JSON item (so `JSON.parse(result.content[0].text)` —
   the pattern ~1500 existing tests use via `parseResult()` — keeps working);
   the `resource_link` is an \_extra* `content[1]` item. `export_bpmn`'s
   `content[0]` genuinely becomes a `resource_link` (no `.text`) when large,
   since there's no equivalent "still JSON" fallback for a raw XML/SVG
   export — safe only because no existing test's diagram crosses either
   threshold.

## Consequences

- All three thresholds are centralized in `src/constants.ts`
  (`LARGE_XML_CHARS`, `LARGE_SVG_CHARS`, `LARGE_LIST_COUNT`) so they can be
  tuned in one place if real-world usage shows they're miscalibrated.
- Every mutating/read tool this ADR touches gained an `inline?: boolean`
  parameter with matching semantics: `false` (default) summarizes past the
  threshold, `true` always returns full content.
- `src/types.ts`'s `ToolResult['content']` items gained `uri`/`name`/
  `description` fields (already optional) to type `resource_link` content
  items without a separate content variant.
