/**
 * Centralised bpmnlint integration module.
 *
 * Owns the bpmnlint `Linter` instance and provides a clean async API
 * for the rest of the codebase.  Also handles loading `.bpmnlintrc`
 * from the working directory.
 */

import { type DiagramState, type ToolResult } from './types';
import type { LintConfig, LintResults, FlatLintIssue } from './bpmnlint-types';
import { configs as localPluginConfigs } from './bpmnlint-plugin-bpmn-mcp';
import camundaTopicWithoutExternalType from './bpmnlint-plugin-bpmn-mcp/rules/camunda-topic-without-external-type';
import gatewayMissingDefault from './bpmnlint-plugin-bpmn-mcp/rules/gateway-missing-default';
import namingConvention from './bpmnlint-plugin-bpmn-mcp/rules/naming-convention';
import gatewayPairMismatch from './bpmnlint-plugin-bpmn-mcp/rules/gateway-pair-mismatch';
import backwardSequenceFlow from './bpmnlint-plugin-bpmn-mcp/rules/backward-sequence-flow';
import implicitSplit from './bpmnlint-plugin-bpmn-mcp/rules/implicit-split';
import laneUsage from './bpmnlint-plugin-bpmn-mcp/rules/lane-usage';
import exclusiveGatewayMarker from './bpmnlint-plugin-bpmn-mcp/rules/exclusive-gateway-marker';
import compensationMissingAssociation from './bpmnlint-plugin-bpmn-mcp/rules/compensation-missing-association';
import boundaryEventScope from './bpmnlint-plugin-bpmn-mcp/rules/boundary-event-scope';
import loopWithoutLimit from './bpmnlint-plugin-bpmn-mcp/rules/loop-without-limit';
import multipleExpandedPools from './bpmnlint-plugin-bpmn-mcp/rules/multiple-expanded-pools';
import exclusiveGatewayConditions from './bpmnlint-plugin-bpmn-mcp/rules/exclusive-gateway-conditions';
import parallelGatewayMergeExclusive from './bpmnlint-plugin-bpmn-mcp/rules/parallel-gateway-merge-exclusive';
import { getAllDiagrams } from './diagram-manager';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

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
    'fake-join': 'info', // downgrade: boundary-event retry patterns produce valid fake-joins
    'camunda-compat/history-time-to-live': 'warn', // upgrade: required for Camunda 7 / Operaton history cleanup
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

const localPlugin = { configs: localPluginConfigs };
const localRuleFactories: Record<string, any> = {
  'camunda-topic-without-external-type': camundaTopicWithoutExternalType,
  'gateway-missing-default': gatewayMissingDefault,
  'naming-convention': namingConvention,
  'gateway-pair-mismatch': gatewayPairMismatch,
  'backward-sequence-flow': backwardSequenceFlow,
  'implicit-split': implicitSplit,
  'lane-usage': laneUsage,
  'exclusive-gateway-marker': exclusiveGatewayMarker,
  'compensation-missing-association': compensationMissingAssociation,
  'boundary-event-scope': boundaryEventScope,
  'loop-without-limit': loopWithoutLimit,
  'multiple-expanded-pools': multipleExpandedPools,
  'exclusive-gateway-conditions': exclusiveGatewayConditions,
  'parallel-gateway-merge-exclusive': parallelGatewayMergeExclusive,
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
export function getDefinitionsFromModeler(modeler: any): any {
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
  hash: string;
  configKey: string;
  results: LintResults;
}

const lintCache = new Map<string, LintCacheEntry>();

/**
 * Compute a content hash for a diagram by serialising the moddle definitions.
 * This is faster than a full saveXML round-trip.
 */
function computeDiagramHash(definitions: any): string {
  // Use JSON of root elements as a fingerprint — fast and deterministic.
  // Track seen objects to break ALL circular references (not just $parent —
  // bpmn-moddle also has sourceRef/targetRef/default cycles).
  const seen = new WeakSet();
  const fingerprint = JSON.stringify(definitions, (_key, value) => {
    if (_key === '$parent') return undefined;
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
  return crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
}

function configCacheKey(config: LintConfig): string {
  return JSON.stringify(config);
}

/** Invalidate lint cache for a specific diagram (called after mutations). */
export function invalidateLintCache(diagramId: string): void {
  lintCache.delete(diagramId);
}

/** Clear the entire lint cache (for testing). */
export function clearLintCache(): void {
  lintCache.clear();
}

/** Reverse-lookup the diagram ID for a DiagramState from the store. */
function getDiagramIdForState(diagram: DiagramState): string | undefined {
  for (const [id, state] of getAllDiagrams()) {
    if (state === diagram) return id;
  }
  return undefined;
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
  const definitions = getDefinitionsFromModeler(diagram.modeler);

  // Check cache
  const diagramId = getDiagramIdForState(diagram);
  if (diagramId) {
    const hash = computeDiagramHash(definitions);
    const ck = configCacheKey(effectiveConfig);
    const cached = lintCache.get(diagramId);
    if (cached && cached.hash === hash && cached.configKey === ck) {
      return cached.results;
    }
  }

  const linter = createLinter(effectiveConfig);
  const results: LintResults = await linter.lint(definitions);

  // Store in cache
  if (diagramId) {
    const hash = computeDiagramHash(definitions);
    const ck = configCacheKey(effectiveConfig);
    lintCache.set(diagramId, { hash, configKey: ck, results });
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

/**
 * Append lint error feedback to a tool result.
 *
 * Only appends error-severity issues to keep implicit feedback concise.
 * Structural completeness rules (start/end event required, no-implicit-start/end)
 * are filtered out because they always fire during incremental construction —
 * they remain enforced at export time and via validate_bpmn_diagram.
 *
 * Skipped when the diagram is in draft mode or batch mode.
 * Wrapped in try/catch so linting failures never break the primary operation.
 * Invalidates the lint cache for this diagram since it's called after mutations.
 */
export async function appendLintFeedback(
  result: ToolResult,
  diagram: DiagramState
): Promise<ToolResult> {
  // In batch mode, skip intermediate lint to avoid N full lint runs
  if (batchMode) return result;

  // In draft mode, skip lint feedback — user explicitly opted out
  if (diagram.draftMode) return result;

  // Invalidate cache since a mutation just occurred
  const diagramId = getDiagramIdForState(diagram);
  if (diagramId) invalidateLintCache(diagramId);

  try {
    const issues = await lintDiagramFlat(diagram);
    const errors = issues.filter(
      (i) => i.severity === 'error' && !INCREMENTAL_NOISE_RULES.has(i.rule)
    );
    if (errors.length === 0) return result;

    // Enrich error messages with contextual hints
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const lines = errors.map((i) => {
      let line = `- [${i.rule}] ${i.message}${i.elementId ? ` (${i.elementId})` : ''}`;
      // Add context for boundary event issues
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
    const feedback = `\n⚠ Lint issues (${errors.length}):\n${lines.join('\n')}`;
    result.content.push({ type: 'text', text: feedback });
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
 * - Missing host for boundary events (before add)
 * - Setting camunda:topic without camunda:type=external (before set-properties)
 *
 * Returns an array of warning strings. Empty array means no issues predicted.
 */
export function predictLintViolations(
  diagram: DiagramState,
  operation: 'connect' | 'add' | 'set-properties',
  params: {
    sourceElementId?: string;
    targetElementId?: string;
    elementType?: string;
    hostElementId?: string;
    properties?: Record<string, any>;
    elementId?: string;
  }
): string[] {
  const warnings: string[] = [];

  if (operation === 'connect' && params.sourceElementId && params.targetElementId) {
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const source = elementRegistry.get(params.sourceElementId);
    if (source?.outgoing) {
      const duplicate = source.outgoing.some(
        (flow: any) => flow.target?.id === params.targetElementId
      );
      if (duplicate) {
        warnings.push(
          `⚠ A sequence flow from ${params.sourceElementId} to ${params.targetElementId} already exists (no-duplicate-sequence-flows rule).`
        );
      }
    }
  }

  if (operation === 'add' && params.elementType === 'bpmn:BoundaryEvent' && !params.hostElementId) {
    warnings.push('⚠ BoundaryEvent requires hostElementId to specify the element to attach to.');
  }

  if (operation === 'set-properties' && params.properties && params.elementId) {
    const props = params.properties;
    if (props['camunda:topic'] && !props['camunda:type']) {
      // Check if the element already has camunda:type=external
      const elementRegistry = diagram.modeler.get('elementRegistry');
      const element = elementRegistry.get(params.elementId);
      if (element) {
        const bo = element.businessObject;
        const currentType = bo?.$attrs?.['camunda:type'];
        if (currentType && currentType !== 'external') {
          warnings.push(
            `⚠ Setting camunda:topic on element with camunda:type='${currentType}' — should be 'external' (camunda-topic-without-external-type rule).`
          );
        }
      }
    }
  }

  return warnings;
}
