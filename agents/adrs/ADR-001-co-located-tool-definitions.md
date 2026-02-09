# ADR-001: Co-located tool definitions

## Status

Accepted

## Decision

Each handler file exports both `handleXxx` and `TOOL_DEFINITION`. This keeps the MCP schema in sync with the implementation, prevents drift, and makes it easy to see exactly what a tool accepts without switching files. `tool-definitions.ts` is a thin barrel that collects them.
