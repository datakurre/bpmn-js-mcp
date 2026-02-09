# ADR-002: Merged auto_layout into layout_diagram

## Status

Accepted

## Decision

`auto_layout` was a strict subset of `layout_diagram` (which called it internally). Having both confused AI callers with a needless choice. Merged into `layout_bpmn_diagram`.
