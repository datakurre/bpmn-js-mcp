# ADR-024: structuredContent and outputSchema for Tool Results

## Status

Accepted

## Context

Every JSON-returning tool handler builds its response through the shared
`jsonResult()` helper (`src/handlers/diagram-access.ts`), which wraps a plain
object as `{ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }`.
The ~1500 existing tests parse that text back with `JSON.parse(result.content[0].text)`
via the `parseResult()` test helper — this exact shape can't change without a
sweeping, high-risk rewrite.

The MCP spec separately supports `structuredContent` on a tool result (a
machine-readable duplicate of a JSON result, for clients that want to consume
it directly instead of parsing a text blob) and `outputSchema` on a tool
definition (declaring what that structured content looks like). The installed
SDK (1.26.0) already types both.

## Decision

1. **`jsonResult()` additionally sets `structuredContent: data`** — the exact
   same object already serialized into `content[0].text`. This is universal
   (all 46 handler files that call `jsonResult()` get it for free) and
   strictly additive: `content[0].text`'s shape, and everything test code
   does with it, is completely unchanged.
2. **`outputSchema` added to 4 tools with a genuinely stable top-level shape**:
   `validate_bpmn_diagram`, `list_bpmn_diagrams`, `list_bpmn_elements`,
   `list_bpmn_process_variables`. Each schema is deliberately minimal —
   `{ type: 'object', properties: { success: {...}, <one count field>: {...} }, required: [...], additionalProperties: true }`
   — describing only the one or two fields that are always present
   regardless of arguments, not every possible nested field. Other tools
   (most of the remaining ~20) were **not** given an `outputSchema`: their
   JSON shape varies too much by arguments/mode to describe accurately in a
   few bytes (e.g. `list_bpmn_diagrams` alone has three different response
   shapes depending on `diagramId`/`compareWith`), and a wrong or
   over-narrow schema is worse than none.
3. **The tool-list size budget test (`test/tool-definitions.test.ts`,
   originally from #6/#8) was raised from 63 KB to 66 KB** to fit these 4
   minimal schemas (~150 bytes each with JSON overhead). This is a
   deliberate, one-time, small increase for a specific new capability, not a
   silent regression — the budget test's own comment documents why.

## Consequences

- Every MCP client that understands `structuredContent` can now consume
  parsed JSON directly from any `jsonResult()`-based tool response, with no
  handler-by-handler work and no `content[0].text` shape change.
- A future tool (or an existing one whose shape stabilizes) can add its own
  `outputSchema` the same minimal way; there's no framework change needed,
  just budget headroom to watch.
- `outputSchema` was deliberately not pursued for tools whose primary output
  isn't JSON (`export_bpmn`'s xml/svg/png/... formats) or whose JSON shape is
  too mode-dependent to describe honestly in a minimal schema.
