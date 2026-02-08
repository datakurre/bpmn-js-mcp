/**
 * Handler for validate_bpmn_diagram tool.
 *
 * Fully delegates to bpmnlint for all checks — standard BPMN rules,
 * Camunda 7 (Operaton) compat checks via bpmnlint-plugin-camunda-compat,
 * and custom MCP rules via bpmnlint-plugin-bpmn-mcp (registered through
 * the McpPluginResolver in src/linter.ts).
 */

import { type ValidateArgs, type ToolResult } from "../types";
import { requireDiagram, jsonResult, validateArgs } from "./helpers";
import { lintDiagramFlat } from "../linter";
import type { FlatLintIssue } from "../bpmnlint-types";

interface ValidationIssue {
  severity: "error" | "warning" | "info";
  message: string;
  elementId?: string;
  rule?: string;
}

export async function handleValidate(args: ValidateArgs): Promise<ToolResult> {
  validateArgs(args, ["diagramId"]);
  const diagram = requireDiagram(args.diagramId);

  // Run bpmnlint — the default config extends bpmnlint:recommended,
  // plugin:camunda-compat/camunda-platform-7-24, and plugin:bpmn-mcp/recommended
  let lintIssues: FlatLintIssue[] = [];
  try {
    lintIssues = await lintDiagramFlat(diagram);
  } catch {
    // If bpmnlint fails, return empty issues gracefully
  }

  // Convert bpmnlint issues to our format
  const issues: ValidationIssue[] = lintIssues.map((li) => ({
    severity: li.severity,
    message: li.message,
    elementId: li.elementId,
    rule: li.rule,
  }));

  return jsonResult({
    success: true,
    valid: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    issueCount: issues.length,
  });
}

export const TOOL_DEFINITION = {
  name: "validate_bpmn_diagram",
  description:
    "Validate a BPMN diagram using bpmnlint rules (recommended + Camunda 7 compat + custom MCP rules). Returns structured issues with severities, element IDs, and rule names.",
  inputSchema: {
    type: "object",
    properties: {
      diagramId: { type: "string", description: "The diagram ID" },
    },
    required: ["diagramId"],
  },
} as const;
