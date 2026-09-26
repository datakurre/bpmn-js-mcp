# ADR-020: Layout Delegated to the bpmn-auto-layout Library

## Status

Accepted — supersedes [ADR-018](ADR-018-elk-removal-rebuild-only.md)

## Context

After ADR-018 the server owned a ~4,000-line in-house layout engine in
`src/rebuild/` (topology analysis, positioning, container sizing, lane
layout, boundary-event placement, waypoint repair), plus an "agent loop"
CLI whose only purpose was to iterate on that engine. Import already used
the `bpmn-auto-layout` npm package to generate initial DI, followed by a
rebuild pass for anything non-trivial.

The layout algorithm has since been developed as a standalone library,
[`github:datakurre/bpmn-auto-layout`](https://github.com/datakurre/bpmn-auto-layout),
which handles gateways, loops, boundary events, subprocesses, pools, lanes,
message flows, artifacts and label placement, and is tested independently.

## Decision

1. **Depend on `github:datakurre/bpmn-auto-layout`** and remove `src/rebuild/`
   and the `agent-loop-*` tooling. Layout algorithm work happens in the
   library.
2. **`src/auto-layout.ts` bridges the library to a live modeler.** The
   library is XML-in / XML-out, so the bridge exports the modeler's XML, runs
   `layoutProcessWithDiagnostics()` (with the Camunda moddle extension so
   `camunda:*` attributes round-trip), reads the generated DI, and applies it
   through `modeling.moveShape` / `resizeShape` / `updateWaypoints` inside a
   single registered compound command. A layout is therefore one undo step
   in `bpmn_history`, and the modeler is never re-imported.
3. **Partial layout on top of a full-diagram library.** The library always
   lays out the whole input, so subsets are handled by the bridge:
   - `scopeElementId` (Participant/SubProcess): take that element and its
     descendants from a full layout, translated so the scope keeps its
     top-left corner.
   - `elementIds` (sibling flow elements): build a pruned standalone process
     containing only those elements (plus boundary events attached to them
     and the flows between them), lay it out, and translate it so the subset
     keeps its top-left corner.
   - Connections crossing the boundary are re-routed with
     `modeling.layoutConnection()`.
4. **Normalise input the library would misread.** Boundary events are moved
   into their host's lane before layout; otherwise the library pulls the host
   (and its connected chunk) into the boundary event's lane.
5. **`import_bpmn_xml` runs the library once**; the rebuild post-pass and its
   "simple linear process" heuristic are gone (`rebuildApplied` was removed
   from the response).
6. **Engine-specific post-passes are dropped** from `layout_bpmn_diagram`:
   U-shaped back-edge re-routing, Z-flow straightening (`straightenFlows`),
   post-layout label adjustment and pool re-stacking. Pool/lane sizing comes
   from the library; the separate autosize pass now only runs with
   `poolExpansion: true`.

## Consequences

- `layout_bpmn_diagram` gains `elementIds`; `straightenFlows` is removed and
  the `boundaryEventWarning` response field is gone.
- The library requires `bpmn-js ^18.28`, which upgraded the hoisted
  `bpmn-js`/`diagram-js`. Two headless adaptations were needed:
  a canvas `measureText` polyfill (text is now measured via canvas, which
  jsdom lacks) and disabling label direct-editing on headless modelers.
- Layout DI is keyed by BPMN ID, which can differ from the element registry
  ID (participants, lanes); the bridge always resolves via
  `businessObject.id`.
- `lane-overcrowding` counts actual rows from DI and `pool-size-insufficient`
  uses a 15px margin, matching the library's compact lane/pool sizing so
  the server's own layout output is not flagged.
- Coordinates are no longer snapped to a 10px grid by default (`gridSnap`
  remains available), which lowers the eval harness's `gridSnapAvg` metric.
- Pinned elements (from `move_bpmn_element`) are still honoured: they keep
  their position and their connections are re-routed.
