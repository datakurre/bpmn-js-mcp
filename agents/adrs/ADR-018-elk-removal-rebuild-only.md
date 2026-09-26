# ADR-018: ELK Removal — Rebuild-Only Layout Engine

## Status

Superseded by [ADR-020](ADR-020-bpmn-auto-layout-library.md)

## Context

After Phases 1–5 (ADR-017) simplified the ELK post-processing pipeline from 30
steps to 8, a parallel rebuild-based layout engine was developed in `src/rebuild/`
that uses topology-driven placement with bpmn-js native positioning (AutoPlace,
ManhattanLayout, modeling APIs).

The rebuild engine:

- Walks the process graph topologically from start events
- Places elements left-to-right using `STANDARD_BPMN_GAP` spacing
- Handles gateway branches by stacking parallel paths vertically
- Processes containers (subprocesses, participants) inside-out
- Re-routes connections via `modeling.layoutConnection()`
- Weighs ~1,000 lines vs ~5,700 lines for the ELK pipeline

With the rebuild engine proving sufficient for all supported layout scenarios,
maintaining two layout engines became unnecessary complexity. Decision D5 in the
project plan resolved to remove ELK entirely.

## Decision

Remove the entire ELK-based layout pipeline and make the rebuild engine the sole
layout strategy. This includes:

1. **Delete `src/elk/` directory** (16 files, ~5,700 lines)
2. **Delete `src/handlers/layout/layout-dryrun.ts`** (inlined into layout handler)
3. **Remove `layoutStrategy`, `direction`, `nodeSpacing`, `layerSpacing`,
   `compactness`, `laneStrategy`, and `elementIds` parameters** from
   `LayoutDiagramArgs` — these were ELK-specific knobs
4. **Remove `elkjs` npm dependency** and esbuild external
5. **Remove all ELK-specific constants** from `src/constants.ts`
6. **Update `import-xml.ts`** to use `rebuildLayout` instead of `elkLayout`
7. **Extract `computeLaneCrossingMetrics`** — the only elk/ utility needed
   outside the module — into `src/handlers/layout/lane-crossing-metrics.ts`
8. **Thread `pinnedElementIds`** through the rebuild engine for user-pinned
   element support
9. **Inline dry-run logic** into the layout handler (clone → rebuild → diff →
   discard)

## Consequences

### Positive

- **~5,000 lines deleted** from production code
- **One layout engine** to maintain, debug, and reason about
- **No external layout dependency** — `elkjs` (~2 MB) removed from bundle
- **Simpler handler interface** — fewer parameters to document and test
- **Faster builds** — one fewer esbuild external to resolve

### Negative

- **No layout direction control** — rebuild always produces left-to-right layout
  (the standard BPMN convention)
- **No custom spacing** — spacing is fixed at `STANDARD_BPMN_GAP` (50px) and
  `LAYER_SPACING` (60px)
- **No partial re-layout** — the `elementIds` parameter for subset layout is
  removed; full layout is always applied

### Neutral

- Existing features (pool/lane autosize, labels-only, dry-run, grid snap,
  scoped layout via `scopeElementId`, expand subprocesses) are preserved
- Lane crossing metrics are extracted to a standalone module and continue to
  work identically
- Pinned element support is preserved via `pinnedElementIds` in `RebuildOptions`

## Files Changed

| Change       | Files                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Deleted      | `src/elk/` (16 files), `src/handlers/layout/layout-dryrun.ts`                                                      |
| Rewritten    | `src/handlers/layout/layout-diagram.ts`, `layout-diagram-schema.ts`, `src/constants.ts`                            |
| Created      | `src/handlers/layout/lane-crossing-metrics.ts`                                                                     |
| Updated      | `src/handlers/core/import-xml.ts`, `src/handlers/elements/insert-element.ts`, `esbuild.config.mjs`, `package.json` |
| Test deleted | 8 ELK-specific test files                                                                                          |
| Test updated | 6 test files (removed ELK-specific parameters)                                                                     |
