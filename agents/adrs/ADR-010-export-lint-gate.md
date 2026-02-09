# ADR-010: Implicit lint gate on export

## Status

Accepted

## Decision

During real usage, AI callers would export invalid diagrams without checking lint first, producing BPMN XML that engines reject. The implicit lint gate in `export_bpmn` catches error-level issues before export. A `skipLint` parameter allows callers to bypass this when they know what they're doing (e.g. exporting a work-in-progress).
