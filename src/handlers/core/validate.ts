/**
 * Handler for validate_bpmn_diagram tool.
 *
 * Fully delegates to bpmnlint for all checks — standard BPMN rules,
 * Camunda 7 (Operaton) compat checks via bpmnlint-plugin-camunda-compat,
 * and custom MCP rules via bpmnlint-plugin-bpmn-mcp (registered through
 * the McpPluginResolver in src/linter.ts).
 *
 * Merges the former lint_bpmn_diagram tool — the config override and
 * per-severity counts are now part of this single tool.
 */

import { type ToolResult } from '../../types';
import { requireDiagram, jsonResult, validateArgs } from '../helpers';
import { lintDiagramFlat, getEffectiveConfig } from '../../linter';
import { suggestFix } from '../../lint-suggestions';
import type { FlatLintIssue, LintConfig } from '../../bpmnlint-types';

export interface ValidateArgs {
  diagramId: string;
  config?: LintConfig;
  lintMinSeverity?: 'error' | 'warning';
}

interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  elementId?: string;
  rule?: string;
  docUrl?: string;
  fix?: string;
  /** Structured tool call suggestion that would fix this issue. */
  fixToolCall?: { tool: string; args: Record<string, any> };
}

/** Fix tool call template. `{diagramId}` and `{elementId}` are substituted at runtime. */
interface FixTemplate {
  tool: string;
  args: Record<string, any>;
  /** Whether this fix requires a known elementId. Default: false. */
  requiresElementId?: boolean;
}

/**
 * Lookup table mapping lint rule names to structured fix tool call templates.
 * Placeholders `'{diagramId}'` and `'{elementId}'` are replaced at runtime.
 */
const FIX_TOOL_CALLS: Record<string, FixTemplate> = {
  'label-required': {
    tool: 'set_bpmn_element_properties',
    args: { properties: { name: '<descriptive name>' } },
    requiresElementId: true,
  },
  'bpmn-mcp/naming-convention': {
    tool: 'set_bpmn_element_properties',
    args: { properties: { name: '<descriptive name>' } },
    requiresElementId: true,
  },
  'start-event-required': {
    tool: 'add_bpmn_element',
    args: { elementType: 'bpmn:StartEvent' },
  },
  'end-event-required': {
    tool: 'add_bpmn_element',
    args: { elementType: 'bpmn:EndEvent' },
  },
  'bpmn-mcp/camunda-topic-without-external-type': {
    tool: 'set_bpmn_element_properties',
    args: { properties: { 'camunda:type': 'external' } },
    requiresElementId: true,
  },
  'no-disconnected': {
    tool: 'connect_bpmn_elements',
    args: { sourceElementId: '<source>' },
    requiresElementId: true,
  },
  'bpmn-mcp/gateway-missing-default': {
    tool: 'connect_bpmn_elements',
    args: { targetElementId: '<target>', isDefault: true },
    requiresElementId: true,
  },
  'bpmn-mcp/exclusive-gateway-conditions': {
    tool: 'set_bpmn_element_properties',
    args: { elementId: '<outgoing-flow-id>', properties: { conditionExpression: '${condition}' } },
    requiresElementId: true,
  },
  'no-implicit-start': {
    tool: 'connect_bpmn_elements',
    args: { sourceElementId: '<source>' },
    requiresElementId: true,
  },
  'no-implicit-end': {
    tool: 'connect_bpmn_elements',
    args: { targetElementId: '<target>' },
    requiresElementId: true,
  },
  'camunda-compat/history-time-to-live': {
    tool: 'set_bpmn_element_properties',
    args: { properties: { 'camunda:historyTimeToLive': '180' } },
  },
  'single-blank-start-event': {
    tool: 'delete_bpmn_element',
    args: {},
  },
  'bpmn-mcp/no-duplicate-named-flow-nodes': {
    tool: 'set_bpmn_element_properties',
    args: { properties: { name: '<unique name>' } },
    requiresElementId: true,
  },
  'bpmn-mcp/parallel-gateway-merge-exclusive': {
    tool: 'replace_bpmn_element',
    args: { newType: 'bpmn:ExclusiveGateway' },
    requiresElementId: true,
  },
  'bpmn-mcp/empty-participant-with-lanes': {
    tool: 'delete_bpmn_element',
    args: {},
    requiresElementId: true,
  },
  'bpmn-mcp/lane-zigzag-flow': {
    tool: 'move_bpmn_element',
    args: { laneId: '<target-lane-id>' },
    requiresElementId: true,
  },
  'bpmn-mcp/service-task-missing-implementation': {
    tool: 'set_bpmn_element_properties',
    args: { properties: { 'camunda:type': 'external', 'camunda:topic': '<topic-name>' } },
    requiresElementId: true,
  },
  'bpmn-mcp/timer-missing-definition': {
    tool: 'set_bpmn_event_definition',
    args: {
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      properties: { timeDuration: 'PT15M' },
    },
    requiresElementId: true,
  },
  'bpmn-mcp/call-activity-missing-called-element': {
    tool: 'set_bpmn_element_properties',
    args: { properties: { calledElement: '<process-id>' } },
    requiresElementId: true,
  },
  'bpmn-mcp/dangling-boundary-event': {
    tool: 'connect_bpmn_elements',
    args: { targetElementId: '<target>' },
    requiresElementId: true,
  },
  'bpmn-mcp/receive-task-missing-message': {
    tool: 'set_bpmn_element_properties',
    args: { properties: { messageRef: '<message-id>' } },
    requiresElementId: true,
  },
  'bpmn-mcp/empty-subprocess': {
    tool: 'add_bpmn_element',
    args: { elementType: 'bpmn:StartEvent' },
    requiresElementId: true,
  },
  'bpmn-mcp/user-task-missing-assignee': {
    tool: 'set_bpmn_element_properties',
    args: { properties: { 'camunda:candidateGroups': '<group-name>' } },
    requiresElementId: true,
  },
  'bpmn-mcp/implicit-merge': {
    tool: 'add_bpmn_element',
    args: { elementType: 'bpmn:ExclusiveGateway' },
    requiresElementId: true,
  },
  'bpmn-mcp/loop-without-limit': {
    tool: 'set_bpmn_loop_characteristics',
    args: { loopType: 'standard', loopMaximum: 10 },
    requiresElementId: true,
  },
  'bpmn-mcp/implicit-split': {
    tool: 'add_bpmn_element',
    args: { elementType: 'bpmn:ExclusiveGateway' },
    requiresElementId: true,
  },
  'bpmn-mcp/elements-outside-participant-bounds': {
    tool: 'layout_bpmn_diagram',
    args: {},
  },
  'bpmn-mcp/missing-di-shape': {
    tool: 'layout_bpmn_diagram',
    args: {},
  },
  'bpmn-mcp/event-subprocess-missing-trigger': {
    tool: 'set_bpmn_event_definition',
    args: { eventDefinitionType: 'bpmn:ErrorEventDefinition' },
    requiresElementId: true,
  },
  'bpmn-mcp/compensation-missing-association': {
    tool: 'connect_bpmn_elements',
    args: { targetElementId: '<compensation-handler>' },
    requiresElementId: true,
  },
  'bpmn-mcp/role-mismatch-with-lane': {
    tool: 'set_bpmn_element_properties',
    args: { properties: { 'camunda:candidateGroups': '<lane-matching-group>' } },
    requiresElementId: true,
  },
};

/**
 * Generate a structured tool call suggestion for a lint issue.
 * Returns an object with tool name and args that would fix the issue.
 */
function suggestFixToolCall(
  issue: FlatLintIssue,
  diagramId: string
): { tool: string; args: Record<string, any> } | undefined {
  const { rule, elementId } = issue;
  if (!rule) return undefined;

  const template = FIX_TOOL_CALLS[rule];
  if (!template) return undefined;
  if (template.requiresElementId && !elementId) return undefined;

  // Build args: always include diagramId, include elementId when available
  const args: Record<string, any> = { diagramId, ...template.args };

  // Inject elementId based on the tool's expected parameter name
  if (elementId) {
    if (template.tool === 'connect_bpmn_elements') {
      // For connect: set sourceElementId or targetElementId based on which is missing
      if (!args.sourceElementId) args.sourceElementId = elementId;
      else if (!args.targetElementId) args.targetElementId = elementId;
    } else if (!args.elementId) {
      args.elementId = elementId;
    }
  }

  return { tool: template.tool, args };
}

export async function handleValidate(args: ValidateArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { config, lintMinSeverity } = args;
  const diagram = requireDiagram(args.diagramId);

  // Resolve the effective bpmnlint config (user override > .bpmnlintrc > default)
  const effectiveConfig = config ? getEffectiveConfig(config) : getEffectiveConfig();

  // Run bpmnlint — the default config extends bpmnlint:recommended,
  // plugin:camunda-compat/camunda-platform-7-24, and plugin:bpmn-mcp/recommended
  let lintIssues: FlatLintIssue[] = [];
  try {
    lintIssues = await lintDiagramFlat(diagram, effectiveConfig);
  } catch {
    // If bpmnlint fails, return empty issues gracefully
  }

  // Convert bpmnlint issues to our format, including docUrl and fix suggestions
  const issues: ValidationIssue[] = lintIssues.map((li) => {
    const fix = suggestFix(li, args.diagramId);
    const fixToolCall = suggestFixToolCall(li, args.diagramId);
    return {
      severity: li.severity,
      message: li.message,
      elementId: li.elementId,
      rule: li.rule,
      ...(li.documentationUrl ? { docUrl: li.documentationUrl } : {}),
      ...(fix ? { fix } : {}),
      ...(fixToolCall ? { fixToolCall } : {}),
    };
  });

  // Filter based on lintMinSeverity if provided
  const blockingSeverities: Set<string> = new Set(['error']);
  if (lintMinSeverity === 'warning') {
    blockingSeverities.add('warning');
  }

  const blockingIssues = issues.filter((i) => blockingSeverities.has(i.severity));

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const infos = issues.filter((i) => i.severity === 'info');

  return jsonResult({
    success: true,
    valid: blockingIssues.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    infoCount: infos.length,
    issues,
    issueCount: issues.length,
  });
}

export const TOOL_DEFINITION = {
  name: 'validate_bpmn_diagram',
  description:
    'Validate a BPMN diagram using bpmnlint rules. Returns structured issues with rule names, severities, element IDs, documentation URLs, and fix suggestions (concrete MCP tool calls to resolve each issue). Uses bpmnlint:recommended by default with tuning for AI-generated diagrams. Supports custom config overrides.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      config: {
        type: 'object',
        description: 'Optional bpmnlint config override. Default extends bpmnlint:recommended.',
        properties: {
          extends: {
            description: "Config(s) to extend, e.g. 'bpmnlint:recommended'",
            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          },
          rules: {
            type: 'object',
            description: 'Rule overrides, e.g. { "label-required": "off" }',
            additionalProperties: { type: 'string', enum: ['off', 'warn', 'error', 'info'] },
          },
        },
      },
      lintMinSeverity: {
        type: 'string',
        enum: ['error', 'warning'],
        description:
          "Minimum lint severity that marks the diagram as invalid. 'error' (default) counts only errors. 'warning' counts warnings too.",
      },
    },
    required: ['diagramId'],
  },
} as const;
