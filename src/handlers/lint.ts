/**
 * Handler for lint_bpmn_diagram tool.
 */

import { type ToolResult } from "../types";
import { validateArgs, requireDiagram, jsonResult } from "./helpers";
import { lintDiagramFlat, getEffectiveConfig } from "../linter";
import type { LintConfig } from "../bpmnlint-types";

export interface LintDiagramArgs {
  diagramId: string;
  config?: LintConfig;
}

export async function handleLintDiagram(
  args: LintDiagramArgs,
): Promise<ToolResult> {
  validateArgs(args, ["diagramId"]);
  const diagram = requireDiagram(args.diagramId);
  const config = args.config ? args.config : getEffectiveConfig();
  const issues = await lintDiagramFlat(diagram, config);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  return jsonResult({
    success: true,
    valid: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    infoCount: infos.length,
    issues,
  });
}

export const TOOL_DEFINITION = {
  name: "lint_bpmn_diagram",
  description:
    "Lint a BPMN diagram using bpmnlint rules. Returns structured issues with rule names, severities, element IDs, and documentation URLs. Uses bpmnlint:recommended by default with tuning for AI-generated diagrams.",
  inputSchema: {
    type: "object",
    properties: {
      diagramId: { type: "string", description: "The diagram ID" },
      config: {
        type: "object",
        description:
          "Optional bpmnlint config override. Default extends bpmnlint:recommended.",
        properties: {
          extends: {
            oneOf: [
              { type: "string" },
              { type: "array", items: { type: "string" } },
            ],
            description:
              "Config(s) to extend, e.g. 'bpmnlint:recommended'",
          },
          rules: {
            type: "object",
            additionalProperties: {
              type: "string",
              enum: ["off", "warn", "error", "info"],
            },
            description:
              'Rule overrides, e.g. { "label-required": "off" }',
          },
        },
      },
    },
    required: ["diagramId"],
  },
} as const;
