# ADR-031 — Lane tools: split mutation from analysis

## Status

Accepted (#23 item 5, fixes #21)

## Context

Lane assignment was possible via four tools, and `analyze_bpmn_lanes` had a
mutating `redistribute` mode despite being annotated read-only.

## Decision

- `create_bpmn_lanes` is the single mutating lane tool: it creates lanes,
  assigns elements (`assignments: [{ laneId, elementIds }]`, absorbing
  `assign_bpmn_elements_to_lane`) and redistributes existing lanes
  (`strategy`, `dryRun`, `validate`, `reposition`, absorbing the `redistribute`
  mode). `participantId` is only required for lane creation and `mergeFrom`.
- `analyze_bpmn_lanes` keeps `suggest` / `validate` / `pool-vs-lanes` and is
  read-only (`readOnlyHint: true`, no MCP Apps viewer).
- `assign_bpmn_elements_to_lane` is removed outright (no hidden alias); its
  handler remains as an internal helper.
- The `assignments` form validates every lane before changing anything.
