/**
 * bpmnlint-plugin-bpmn-mcp
 *
 * Custom bpmnlint plugin with rules specific to MCP-generated BPMN models
 * targeting Camunda 7 (Operaton).
 *
 * Rules are registered with the bpmnlint Linter via McpPluginResolver
 * in src/linter.ts, allowing config references like:
 *   { extends: ['plugin:bpmn-mcp/recommended'] }
 *   { rules: { 'bpmn-mcp/gateway-missing-default': 'error' } }
 */

export const configs = {
  recommended: {
    rules: {
      "bpmn-mcp/camunda-topic-without-external-type": "warn",
      "bpmn-mcp/gateway-missing-default": "warn",
    },
  },
};
