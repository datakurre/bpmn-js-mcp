# ADR-015: All tool names include "bpmn"

## Status

Accepted

## Decision

When multiple MCP servers are active, tool names must be globally unique. Generic names like `delete_diagram` or `set_form_data` could collide with tools from other MCPs. Adding `bpmn` to every tool name (e.g. `delete_bpmn_diagram`, `set_bpmn_form_data`) eliminates this risk. No backward-compat aliases — MCP tool namespaces don't need them.
