# ADR-008: Implicit lint feedback only includes errors

## Status

Accepted

## Decision

`appendLintFeedback()` filters to error-severity issues only. Including warnings would make every response verbose during incremental diagram construction. The explicit `lint_bpmn_diagram` tool returns all severities for callers who want the full picture.
