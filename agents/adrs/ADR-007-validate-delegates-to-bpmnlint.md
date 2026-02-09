# ADR-007: validate_bpmn_diagram delegates to bpmnlint

## Status

Accepted

## Decision

The hand-written checks in the original `validate` handler overlapped significantly with bpmnlint rules (`start-event-required`, `end-event-required`, `no-disconnected`, `label-required`). Delegating to bpmnlint eliminates maintenance burden while adding 27+ additional checks. Camunda-specific checks (`camunda-topic-without-external-type`, `gateway-missing-default`) are now registered as proper bpmnlint rules in `bpmnlint-plugin-bpmn-mcp` and resolved via `McpPluginResolver`, so the validate handler no longer needs manual check functions.
