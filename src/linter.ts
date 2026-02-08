/**
 * Centralised bpmnlint integration module.
 *
 * Owns the bpmnlint `Linter` instance and provides a clean async API
 * for the rest of the codebase.  Also handles loading `.bpmnlintrc`
 * from the working directory.
 */

import { type DiagramState, type ToolResult } from "./types";
import type { LintConfig, LintResults, FlatLintIssue } from "./bpmnlint-types";
import { configs as localPluginConfigs } from "./bpmnlint-plugin-bpmn-mcp";
import camundaTopicWithoutExternalType from "./bpmnlint-plugin-bpmn-mcp/rules/camunda-topic-without-external-type";
import gatewayMissingDefault from "./bpmnlint-plugin-bpmn-mcp/rules/gateway-missing-default";
import * as fs from "fs";
import * as path from "path";

// ── Default configuration ──────────────────────────────────────────────────

/** Default config used when no user config or `.bpmnlintrc` is found. */
export const DEFAULT_LINT_CONFIG: LintConfig = {
  extends: [
    "bpmnlint:recommended",
    "plugin:camunda-compat/camunda-platform-7-24",
    "plugin:bpmn-mcp/recommended",
  ],
  rules: {
    // Tune for AI-generated executable BPMN:
    "label-required": "warn",          // downgrade: AI callers may add labels incrementally
    "no-overlapping-elements": "off",  // layout handles this; false positives in headless mode
    "no-disconnected": "warn",         // downgrade: diagrams are built incrementally
  },
};

// ── .bpmnlintrc support ────────────────────────────────────────────────────

let userConfig: LintConfig | null | undefined; // undefined = not checked yet

/**
 * Attempt to load a `.bpmnlintrc` file from the current working directory.
 * Returns the parsed config, or null if no file exists.
 */
function loadBpmnlintrc(): LintConfig | null {
  try {
    const rcPath = path.resolve(process.cwd(), ".bpmnlintrc");
    if (fs.existsSync(rcPath)) {
      const content = fs.readFileSync(rcPath, "utf-8");
      return JSON.parse(content) as LintConfig;
    }
  } catch {
    // Malformed file — fall back to defaults silently
  }
  return null;
}

/**
 * Get the effective lint config: user `.bpmnlintrc` > provided config > default.
 */
export function getEffectiveConfig(override?: LintConfig): LintConfig {
  if (override) return override;
  if (userConfig === undefined) {
    userConfig = loadBpmnlintrc();
  }
  return userConfig ?? DEFAULT_LINT_CONFIG;
}

/** Reset the cached user config (for testing). */
export function resetUserConfig(): void {
  userConfig = undefined;
}

// ── Linter instance management ─────────────────────────────────────────────

// ── Custom resolver for bpmnlint ───────────────────────────────────────────
//
// Wraps NodeResolver and intercepts requests for our local plugin
// (bpmnlint-plugin-bpmn-mcp) so that its rules and configs can be
// referenced in bpmnlint config without being an npm package.

const localPlugin = { configs: localPluginConfigs };
const localRuleFactories: Record<string, any> = {
  "camunda-topic-without-external-type": camundaTopicWithoutExternalType,
  "gateway-missing-default": gatewayMissingDefault,
};

/**
 * Custom bpmnlint resolver that wraps NodeResolver and adds resolution
 * for our bundled `bpmnlint-plugin-bpmn-mcp` plugin.
 *
 * This allows bpmnlint config to reference `plugin:bpmn-mcp/recommended`
 * and `bpmn-mcp/rule-name` without the plugin being in node_modules.
 */
function createMcpResolver(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const NodeResolver = require("bpmnlint/lib/resolver/node-resolver");
  const nodeResolver = new NodeResolver();

  return {
    resolveRule(pkg: string, ruleName: string) {
      if (pkg === "bpmnlint-plugin-bpmn-mcp") {
        const factory = localRuleFactories[ruleName];
        if (factory) return factory;
        throw new Error(`cannot resolve rule <${ruleName}> from <${pkg}>`);
      }
      return nodeResolver.resolveRule(pkg, ruleName);
    },
    resolveConfig(pkg: string, configName: string) {
      if (pkg === "bpmnlint-plugin-bpmn-mcp") {
        const config = (localPlugin.configs as Record<string, any>)?.[configName];
        if (config) return config;
        throw new Error(`cannot resolve config <${configName}> from <${pkg}>`);
      }
      return nodeResolver.resolveConfig(pkg, configName);
    },
  };
}

let cachedLinter: any = null;
let cachedConfigKey: string | null = null;

function getLinter(config: LintConfig): any {
  const configKey = JSON.stringify(config);
  if (cachedLinter && configKey === cachedConfigKey) {
    return cachedLinter;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Linter } = require("bpmnlint");
  cachedLinter = new Linter({
    config,
    resolver: createMcpResolver(),
  });
  cachedConfigKey = configKey;
  return cachedLinter;
}

/** Reset the cached linter (for testing). */
export function resetLinterCache(): void {
  cachedLinter = null;
  cachedConfigKey = null;
}

// ── Get moddle definitions from bpmn-js modeler ────────────────────────────

/**
 * Extract the moddle `bpmn:Definitions` root element from a bpmn-js modeler.
 *
 * bpmnlint requires a moddle root element — not raw XML.
 */
export function getDefinitionsFromModeler(modeler: any): any {
  // Public API in bpmn-js >= 7.x
  if (typeof modeler.getDefinitions === "function") {
    return modeler.getDefinitions();
  }
  // Fallback: internal property
  if (modeler._definitions) {
    return modeler._definitions;
  }
  // Last resort: get from canvas root element's business object parent chain
  const canvas = modeler.get("canvas");
  const root = canvas.getRootElement();
  let bo = root.businessObject;
  while (bo && bo.$type !== "bpmn:Definitions" && bo.$parent) {
    bo = bo.$parent;
  }
  if (bo && bo.$type === "bpmn:Definitions") {
    return bo;
  }
  throw new Error("Unable to extract bpmn:Definitions from modeler");
}

// ── Core linting functions ─────────────────────────────────────────────────

/**
 * Lint a diagram using bpmnlint and return raw results keyed by rule name.
 */
export async function lintDiagram(
  diagram: DiagramState,
  config?: LintConfig,
): Promise<LintResults> {
  const effectiveConfig = getEffectiveConfig(config);
  const linter = getLinter(effectiveConfig);
  const definitions = getDefinitionsFromModeler(diagram.modeler);
  return linter.lint(definitions);
}

/**
 * Lint a diagram and return a flat array of issues (easier to consume).
 */
export async function lintDiagramFlat(
  diagram: DiagramState,
  config?: LintConfig,
): Promise<FlatLintIssue[]> {
  const results = await lintDiagram(diagram, config);
  const flat: FlatLintIssue[] = [];
  for (const [rule, reports] of Object.entries(results)) {
    for (const report of reports) {
      flat.push({
        rule,
        severity: report.category === "warn" ? "warning" : report.category === "error" ? "error" : "info",
        message: report.message,
        elementId: report.id,
        documentationUrl: report.meta?.documentation?.url,
      });
    }
  }
  return flat;
}

// ── Implicit lint feedback ─────────────────────────────────────────────────

/**
 * Append lint error feedback to a tool result.
 *
 * Only appends error-severity issues to keep implicit feedback concise.
 * Wrapped in try/catch so linting failures never break the primary operation.
 */
export async function appendLintFeedback(
  result: ToolResult,
  diagram: DiagramState,
): Promise<ToolResult> {
  try {
    const issues = await lintDiagramFlat(diagram);
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length === 0) return result;

    const lines = errors.map(
      (i) => `- [${i.rule}] ${i.message}${i.elementId ? ` (${i.elementId})` : ""}`,
    );
    const feedback = `\n⚠ Lint issues (${errors.length}):\n${lines.join("\n")}`;
    result.content.push({ type: "text", text: feedback });
  } catch {
    // Linting should never break the primary tool response
  }
  return result;
}

// ── Pre-modification lint guard ────────────────────────────────────────────

/**
 * Check for specific lint violations that would result from a pending operation.
 *
 * Currently checks:
 * - Duplicate sequence flows (before connect)
 *
 * Returns an array of warning strings. Empty array means no issues predicted.
 */
export function predictLintViolations(
  diagram: DiagramState,
  operation: "connect",
  params: { sourceElementId?: string; targetElementId?: string },
): string[] {
  const warnings: string[] = [];

  if (operation === "connect" && params.sourceElementId && params.targetElementId) {
    const elementRegistry = diagram.modeler.get("elementRegistry");
    const source = elementRegistry.get(params.sourceElementId);
    if (source?.outgoing) {
      const duplicate = source.outgoing.some(
        (flow: any) => flow.target?.id === params.targetElementId,
      );
      if (duplicate) {
        warnings.push(
          `⚠ A sequence flow from ${params.sourceElementId} to ${params.targetElementId} already exists (no-duplicate-sequence-flows rule).`,
        );
      }
    }
  }

  return warnings;
}
