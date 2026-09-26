# ADR-022: Headless Rendering Delegated to the bpmn-to-image Library

## Status

Accepted

## Context

This repo owned a full headless bpmn-js stack: `src/headless-canvas.ts`
(jsdom setup, lazy `BpmnModeler` construction, `eval`-loading the bpmn-js
browser bundle), `src/headless-polyfills.ts` (SVGMatrix, getBBox,
getScreenCTM, transform, canvas `measureText`, SVG path stubs),
`src/headless-bbox.ts` (element-type-aware bounding box estimation),
`src/headless-path.ts` (SVG path `d` parser), and `src/svg-to-png.ts`
(resvg-js rasterization, viewBox cropping/tightening, bundled Liberation
Sans fonts).

A sibling project, [`bpmn-to-image`](https://github.com/datakurre/bpmn-to-image),
extracted this exact stack into a standalone, independently tested library
(originally split out of this codebase), and has since gained capabilities
this project didn't have: a `headless-canvas-2d.ts` module, real polyline
`getTotalLength()`/`getPointAtLength()` geometry for M/L-only SVG paths,
`fixMarkerUrls()` (strips quotes from `marker-end: url('#id')` so resvg-js's
Rust SVG parser doesn't drop arrowheads), background-color and padding-object
support in `tightenSvgViewBox`/`cropSvgToViewBox`, token-simulation frame
rendering, and interactive HTML export. Maintaining a second, drifting copy
of the same headless-rendering code in this repo no longer made sense.

Before depending on it, every file was diffed against this repo's copy:
`headless-canvas.ts` and `headless-bbox.ts` are byte-identical;
`headless-path.ts` and `svg-to-png.ts` are strict supersets (new optional
parameters/exports, unchanged existing call signatures); `headless-polyfills.ts`
replaces this repo's neutral `getTotalLength()`/`getPointAtLength()` stubs
with real polyline-geometry computation for M/L paths (falling back to the
same neutral stubs otherwise) — safe because no existing bpmn-js-mcp code
path (`getCroppedWaypoints()`, `layoutConnection()`,
`moveElements([boundaryEvent])`) depends on real values from those two
methods.

## Decision

1. **Depend on `bpmn-to-image` via `github:datakurre/bpmn-to-image`** (same
   git-dependency pattern as `bpmn-auto-layout`, ADR-020) rather than the
   npm registry, since the registry release predates the changes this
   project relies on.
2. **Delete this repo's own copies**: `src/headless-canvas.ts`,
   `src/headless-bbox.ts`, `src/headless-path.ts`,
   `src/headless-polyfills.ts`, `src/svg-to-png.ts`, `fonts/`, and their
   dedicated tests (`test/headless-polyfills.test.ts`,
   `test/svg-to-png.test.ts`, `test/handlers/layout/getbbox-polyfill.test.ts`).
   `jsdom`, `@resvg/resvg-js` and `@types/jsdom` are dropped as direct
   dependencies — they're consumed transitively through `bpmn-to-image` now.
3. **`src/diagram-manager.ts` builds its modeler on the library's
   `createModeler({ robot: false })`**, which already registers the Camunda
   moddle extension by default. `robot: false` keeps rendering identical to
   before — the library's Robot Framework task-icon renderer is opt-in and
   unused here. `directEditing.activate = () => false` is still applied
   locally (bpmn-js-mcp-specific: headless label direct-editing throws mid
   command).
4. **`src/handlers/core/create-diagram.ts` and `src/linter.ts` import
   `svgToPngWithFallback`/`cropSvgToViewBox`/`tightenSvgViewBox` from
   `bpmn-to-image`** instead of the local `./svg-to-png` module. Call sites
   were unchanged since the library's versions are backward-compatible
   supersets of the same functions.
5. **`esbuild.config.mjs`'s `external` list swaps `jsdom` for
   `bpmn-to-image`** (the library itself remains unbundled, resolved from
   `node_modules` at runtime, same as `bpmn-js`/`bpmn-auto-layout`).

## Consequences

- `bpmn-js` is hoisted to a single shared copy satisfying both this repo's
  own `^18.28.0` and the library's `^18.26.0` range; no nested/duplicate
  bpmn-js instances.
- The hoisted `bpmn-js` version moved to 18.30.x as a side effect, which
  changed two cosmetic details in raw `saveSVG()` output: the default theme
  color's CSS notation (`hsl(225, 10%, 15%)` → `rgb(34, 36, 42)` — the same
  color, not a rendering change) and `marker-end` URL refs are now
  single-quoted (`url('#marker-...')` instead of `url(#markerId)`). SVG
  snapshot tests were updated, and their volatile-ID normalization regex
  was fixed to also match the quoted form (it previously only matched
  unquoted `url(#...)`, which let the random marker suffix leak through
  into snapshots as nondeterministic noise).
- Any future headless-rendering polyfill or bbox-estimation change belongs
  in `bpmn-to-image`, not this repo — mirrors the existing rule for layout
  algorithm changes belonging in `bpmn-auto-layout` (ADR-020).
