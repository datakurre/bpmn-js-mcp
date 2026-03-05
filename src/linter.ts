/**
 * Centralised bpmnlint integration module.
 *
 * Owns the bpmnlint `Linter` instance and provides a clean async API
 * for the rest of the codebase.  Also handles loading `.bpmnlintrc`
 * from the working directory.
 */

import { type DiagramState, type ToolResult, type HintLevel } from './types';
import type { BpmnDefinitions } from './bpmn-types';
import type { LintConfig, LintResults, FlatLintIssue } from './bpmnlint-types';
import { suggestFix } from './lint-suggestions';
import {
  configs as localPluginConfigs,
  rules as localRuleFactories,
} from './bpmnlint-plugin-bpmn-mcp';
import { getDiagramId } from './diagram-manager';
import { buildConnectivityWarnings } from './handlers/helpers';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Default configuration ──────────────────────────────────────────────────

/** Default config used when no user config or `.bpmnlintrc` is found. */
export const DEFAULT_LINT_CONFIG: LintConfig = {
  extends: [
    'bpmnlint:recommended',
    'plugin:camunda-compat/camunda-platform-7-24',
    'plugin:bpmn-mcp/recommended',
  ],
  rules: {
    // Tune for AI-generated executable BPMN:
    'label-required': 'warn', // downgrade: AI callers may add labels incrementally
    'no-overlapping-elements': 'off', // layout handles this; false positives in headless mode
    'no-disconnected': 'warn', // downgrade: diagrams are built incrementally
    'no-inclusive-gateway': 'info', // informational: InclusiveGateway is valid in Camunda 7 / Operaton
    'fake-join': 'info', // downgrade: boundary-event retry patterns produce valid fake-joins
    'camunda-compat/history-time-to-live': 'warn', // upgrade: required for Camunda 7 / Operaton history cleanup
    'camunda-compat/inclusive-gateway': 'info', // informational: Camunda 7 supports InclusiveGateway joins
    'bpmn-mcp/gateway-pair-mismatch': 'info', // informational: split-without-join is valid when branches terminate
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
    const rcPath = path.resolve(process.cwd(), '.bpmnlintrc');
    if (fs.existsSync(rcPath)) {
      const content = fs.readFileSync(rcPath, 'utf-8');
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

const localPlugin = { configs: localPluginConfigs, rules: localRuleFactories };

/**
 * Custom bpmnlint resolver that wraps NodeResolver and adds resolution
 * for our bundled `bpmnlint-plugin-bpmn-mcp` plugin.
 *
 * This allows bpmnlint config to reference `plugin:bpmn-mcp/recommended`
 * and `bpmn-mcp/rule-name` without the plugin being in node_modules.
 */
function createMcpResolver(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const NodeResolver = require('bpmnlint/lib/resolver/node-resolver');
  const nodeResolver = new NodeResolver();

  return {
    resolveRule(pkg: string, ruleName: string) {
      if (pkg === 'bpmnlint-plugin-bpmn-mcp') {
        const factory = localRuleFactories[ruleName];
        if (factory) return factory;
        throw new Error(`cannot resolve rule <${ruleName}> from <${pkg}>`);
      }
      return nodeResolver.resolveRule(pkg, ruleName);
    },
    resolveConfig(pkg: string, configName: string) {
      if (pkg === 'bpmnlint-plugin-bpmn-mcp') {
        const config = (localPlugin.configs as Record<string, any>)?.[configName];
        if (config) return config;
        throw new Error(`cannot resolve config <${configName}> from <${pkg}>`);
      }
      return nodeResolver.resolveConfig(pkg, configName);
    },
  };
}

/**
 * Create a fresh Linter instance for the given config.
 *
 * A new instance is created on every call because bpmnlint caches rule
 * factory results inside the Linter (e.g. `this.cachedRules`). Some rules
 * like `no-duplicate-sequence-flows` use closure state that accumulates
 * across `lint()` calls, causing false positives when the Linter is reused.
 */
function createLinter(config: LintConfig): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Linter } = require('bpmnlint');
  return new Linter({
    config,
    resolver: createMcpResolver(),
  });
}

/** @deprecated No-op retained for backward compatibility in tests. */
export function resetLinterCache(): void {
  // Intentionally empty — fresh linters are created per call now.
}

// ── Get moddle definitions from bpmn-js modeler ────────────────────────────

/**
 * Extract the moddle `bpmn:Definitions` root element from a bpmn-js modeler.
 *
 * bpmnlint requires a moddle root element — not raw XML.
 */
export function getDefinitionsFromModeler(modeler: any): BpmnDefinitions {
  // Public API in bpmn-js >= 7.x
  if (typeof modeler.getDefinitions === 'function') {
    return modeler.getDefinitions();
  }
  // Fallback: internal property
  if (modeler._definitions) {
    return modeler._definitions;
  }
  // Last resort: get from canvas root element's business object parent chain
  const canvas = modeler.get('canvas');
  const root = canvas.getRootElement();
  let bo = root.businessObject;
  while (bo && bo.$type !== 'bpmn:Definitions' && bo.$parent) {
    bo = bo.$parent;
  }
  if (bo && bo.$type === 'bpmn:Definitions') {
    return bo;
  }
  throw new Error('Unable to extract bpmn:Definitions from modeler');
}

// ── Lint result caching ────────────────────────────────────────────────────

interface LintCacheEntry {
  version: number;
  configKey: string;
  results: LintResults;
}

const lintCache = new Map<string, LintCacheEntry>();

/**
 * Get the current version of a diagram.
 * Returns the version counter from DiagramState (bumped on each mutation).
 */
function getDiagramVersion(diagram: DiagramState): number {
  return diagram.version ?? 0;
}

/**
 * Bump the version counter on a diagram state.
 * Called after mutations to signal that lint cache is stale.
 */
function bumpDiagramVersion(diagram: DiagramState): void {
  diagram.version = (diagram.version ?? 0) + 1;
  diagram.mutationsSinceLayout = (diagram.mutationsSinceLayout ?? 0) + 1;
}

/**
 * Reset the structural mutation counter (called after layout_bpmn_diagram).
 */
export function resetMutationCounter(diagram: DiagramState): void {
  diagram.mutationsSinceLayout = 0;
}

function configCacheKey(config: LintConfig): string {
  return JSON.stringify(config);
}

/** Invalidate lint cache for a specific diagram (called after mutations). */
function invalidateLintCache(diagramId: string): void {
  lintCache.delete(diagramId);
}

/** Clear the entire lint cache (for testing). */
export function clearLintCache(): void {
  lintCache.clear();
}

// ── Core linting functions ─────────────────────────────────────────────────

/**
 * Lint a diagram using bpmnlint and return raw results keyed by rule name.
 * Results are cached keyed on a content hash and invalidated on mutations.
 */
export async function lintDiagram(
  diagram: DiagramState,
  config?: LintConfig
): Promise<LintResults> {
  const effectiveConfig = getEffectiveConfig(config);

  // Check cache
  const diagramId = getDiagramId(diagram);
  const currentVersion = getDiagramVersion(diagram);
  if (diagramId) {
    const ck = configCacheKey(effectiveConfig);
    const cached = lintCache.get(diagramId);
    if (cached && cached.version === currentVersion && cached.configKey === ck) {
      return cached.results;
    }
  }

  const definitions = getDefinitionsFromModeler(diagram.modeler);
  const linter = createLinter(effectiveConfig);
  const results: LintResults = await linter.lint(definitions);

  // Store in cache
  if (diagramId) {
    const ck = configCacheKey(effectiveConfig);
    lintCache.set(diagramId, { version: currentVersion, configKey: ck, results });
  }

  return results;
}

/**
 * Lint a diagram and return a flat array of issues (easier to consume).
 */
export async function lintDiagramFlat(
  diagram: DiagramState,
  config?: LintConfig
): Promise<FlatLintIssue[]> {
  const results = await lintDiagram(diagram, config);
  const flat: FlatLintIssue[] = [];
  for (const [rule, reports] of Object.entries(results)) {
    for (const report of reports) {
      flat.push({
        rule,
        severity:
          report.category === 'warn' ? 'warning' : report.category === 'error' ? 'error' : 'info',
        message: report.message,
        elementId: report.id,
        documentationUrl: report.meta?.documentation?.url,
      });
    }
  }
  return flat;
}

// ── Batch mode flag ────────────────────────────────────────────────────────

let batchMode = false;

/**
 * Enable or disable batch mode.  When enabled, `appendLintFeedback()` is
 * a no-op — the batch handler runs a single lint pass at the end instead.
 */
export function setBatchMode(enabled: boolean): void {
  batchMode = enabled;
}

// ── Server-wide hint level ─────────────────────────────────────────────────

let serverHintLevel: HintLevel = 'full';

/** Set the server-wide default hint level (e.g. from CLI --hint-level). */
export function setServerHintLevel(level: HintLevel): void {
  serverHintLevel = level;
}

/** Get the server-wide default hint level. */
export function getServerHintLevel(): HintLevel {
  return serverHintLevel;
}

/**
 * Resolve the effective hint level for a diagram.
 *
 * Priority: diagram.hintLevel > diagram.draftMode > server default.
 */
export function resolveHintLevel(diagram: DiagramState): HintLevel {
  if (diagram.hintLevel !== undefined) return diagram.hintLevel;
  if (diagram.draftMode) return 'none';
  return serverHintLevel;
}

// ── Implicit lint feedback ─────────────────────────────────────────────────

/**
 * Structural completeness rules that always fire during incremental diagram
 * construction (e.g. no end event yet, missing start event, etc.).
 *
 * These are filtered from implicit feedback (`appendLintFeedback`) to reduce
 * noise, but are still enforced at export time via the lint gate and are
 * visible via `validate_bpmn_diagram`.
 */
const INCREMENTAL_NOISE_RULES = new Set([
  'start-event-required',
  'end-event-required',
  'no-implicit-start',
  'no-implicit-end',
]);

/** Append PNG image content to a ToolResult (non-fatal). */
async function appendPngImageContent(result: ToolResult, modeler: any): Promise<void> {
  try {
    const { svgToPng } = await import('./svg-to-png');
    const { svg } = await modeler.saveSVG();
    const pngBuffer = svgToPng(svg);
    const base64 = pngBuffer.toString('base64');
    result.content.push({
      type: 'image',
      data: base64,
      mimeType: 'image/png',
      annotations: { audience: ['user'] },
    });
  } catch {
    // Non-fatal — image conversion should never break the primary operation
  }
}

/** Append layout hint and connectivity warnings to result (full hint level only). */
async function appendFullHints(result: ToolResult, diagram: DiagramState): Promise<void> {
  const LAYOUT_HINT_THRESHOLD = 5;
  const mutations = diagram.mutationsSinceLayout ?? 0;
  if (mutations >= LAYOUT_HINT_THRESHOLD && mutations % LAYOUT_HINT_THRESHOLD === 0) {
    result.content.push({
      type: 'text',
      text: `\n💡 Hint: ${mutations} changes since last layout — consider calling layout_bpmn_diagram to arrange elements.`,
    });
  }
  try {
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const flowElements = elementRegistry.filter(
      (el: any) =>
        el.type &&
        (el.type.includes('Event') ||
          el.type.includes('Task') ||
          el.type.includes('Gateway') ||
          el.type.includes('SubProcess') ||
          el.type.includes('CallActivity'))
    );
    if (flowElements.length > 3) {
      const connectivityWarnings = buildConnectivityWarnings(elementRegistry);
      if (connectivityWarnings.length > 0) {
        result.content.push({ type: 'text', text: '\n' + connectivityWarnings.join('\n') });
      }
    }
  } catch {
    // Non-fatal
  }
}

/** Append lint error feedback lines to result. */
async function appendLintErrors(result: ToolResult, diagram: DiagramState): Promise<void> {
  try {
    const issues = await lintDiagramFlat(diagram);
    const errors = issues.filter(
      (i) => i.severity === 'error' && !INCREMENTAL_NOISE_RULES.has(i.rule)
    );
    if (errors.length === 0) return;
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const dId = getDiagramId(diagram) ?? '';
    const lines = errors.map((i) => {
      let line = `- [${i.rule}] ${i.message}${i.elementId ? ` (${i.elementId})` : ''}`;
      const fix = suggestFix(i, dId);
      if (fix) line += ` → ${fix}`;
      if (i.elementId && (i.rule === 'no-implicit-start' || i.rule === 'no-implicit-end')) {
        const el = elementRegistry.get(i.elementId);
        if (el?.type === 'bpmn:BoundaryEvent' && !el.host) {
          line +=
            ' — This boundary event is not attached to a host element. ' +
            'Use add_bpmn_element with hostElementId to attach it to a task or subprocess.';
        }
      }
      return line;
    });
    result.content.push({
      type: 'text',
      text: `\n⚠ Lint issues (${errors.length}):\n${lines.join('\n')}`,
    });
  } catch {
    // Linting should never break the primary tool response
  }
}

/**
 * Append lint error feedback to a tool result.
 *
 * Only appends error-severity issues to keep implicit feedback concise.
 * Structural completeness rules (start/end event required, no-implicit-start/end)
 * are filtered out because they always fire during incremental construction —
 * they remain enforced at export time and via validate_bpmn_diagram.
 *
 * Feedback verbosity is controlled by the diagram's effective hint level:
 * - `'full'`    — lint errors + layout hints + connectivity warnings
 * - `'minimal'` — lint errors only
 * - `'none'`   — no implicit feedback (legacy draftMode equivalent)
 *
 * Skipped in batch mode.
 * Wrapped in try/catch so linting failures never break the primary operation.
 * Invalidates the lint cache for this diagram since it's called after mutations.
 */
export async function appendLintFeedback(
  result: ToolResult,
  diagram: DiagramState
): Promise<ToolResult> {
  if (batchMode) return result;

  const hintLevel = resolveHintLevel(diagram);
  const willAppendFeedback = hintLevel !== 'none';
  const willAppendImage = !!diagram.includeImage;

  if (!willAppendFeedback && !willAppendImage) return result;

  bumpDiagramVersion(diagram);
  const diagramId = getDiagramId(diagram);
  if (diagramId) invalidateLintCache(diagramId);

  if (willAppendFeedback) {
    await appendLintErrors(result, diagram);
    if (hintLevel === 'full') {
      await appendFullHints(result, diagram);
    }
  }

  if (willAppendImage) {
    await appendPngImageContent(result, diagram.modeler);
  }

  return result;
}
