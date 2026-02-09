# ADR-006: bpmnlint integration via McpPluginResolver

## Status

Accepted

## Decision

bpmnlint uses dynamic `require()` to resolve rules and configs at runtime. Rather than fighting esbuild bundling with a `StaticResolver`, bpmnlint and `bpmnlint-plugin-camunda-compat` are marked `external` in esbuild (same as `bpmn-js` and `jsdom`), letting `NodeResolver` work naturally from `node_modules`. The `McpPluginResolver` wraps `NodeResolver` and intercepts requests for our bundled `bpmnlint-plugin-bpmn-mcp` plugin, serving its rules and configs from ES imports within the bundle.
