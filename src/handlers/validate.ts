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

import { type ValidateArgs, type ToolResult } from '../types';
import { requireDiagram, jsonResult, validateArgs } from './helpers';
import { lintDiagramFlat, getEffectiveConfig } from '../linter';
import type { FlatLintIssue } from '../bpmnlint-types';

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

/**
 * Lookup table mapping lint rule names to fix suggestion templates.
 * `{elementRef}` is replaced with the element reference at runtime.
 * `{diagramId}` is replaced with the diagram ID.
 */
const FIX_SUGGESTIONS: Record<string, string> = {
  'label-required': 'Use set_bpmn_element_properties to set a descriptive name{elementRef}',
  'bpmn-mcp/naming-convention':
    'Use set_bpmn_element_properties to set a descriptive name{elementRef}',
  'no-disconnected': 'Use connect_bpmn_elements to connect the disconnected element{elementRef}',
  'start-event-required': 'Use add_bpmn_element to add a bpmn:StartEvent to diagram "{diagramId}"',
  'end-event-required': 'Use add_bpmn_element to add a bpmn:EndEvent to diagram "{diagramId}"',
  'bpmn-mcp/gateway-missing-default':
    'Use connect_bpmn_elements with isDefault: true to set a default flow{elementRef}',
  'bpmn-mcp/implicit-split':
    'Replace conditional flows with an explicit gateway{elementRef} — add a bpmn:ExclusiveGateway after the task',
  'bpmn-mcp/backward-sequence-flow':
    'Use layout_bpmn_diagram to re-arrange elements left-to-right, or restructure the flow{elementRef}',
  'bpmn-mcp/lane-usage':
    'Consider using create_bpmn_collaboration with separate pools instead of lanes',
  'bpmn-mcp/camunda-topic-without-external-type':
    'Use set_bpmn_element_properties to set camunda:type to "external"{elementRef}',
  'bpmn-mcp/loop-without-limit':
    'Use set_bpmn_loop_characteristics to set a completionCondition or loopMaximum{elementRef}',
  'bpmn-mcp/compensation-missing-association':
    'Use connect_bpmn_elements to associate the compensation boundary event with a compensation handler{elementRef}',
  'bpmn-mcp/multiple-expanded-pools':
    'In Camunda 7 / Operaton, only one pool can be executed. Recreate non-executable pools with collapsed: true in create_bpmn_collaboration, or delete the extra expanded pool and use bpmn:ServiceTask (camunda:type="external") instead',
  'no-implicit-start':
    'Element{elementRef} has no incoming sequence flow. Connect it with connect_bpmn_elements or verify it should be a start event',
  'no-implicit-end':
    'Element{elementRef} has no outgoing sequence flow. Connect it with connect_bpmn_elements or verify it should be an end event',
  'single-blank-start-event':
    'Process should have exactly one blank start event. Remove extra start events with delete_bpmn_element or add event definitions with set_bpmn_event_definition',
  'bpmn-mcp/exclusive-gateway-conditions':
    'Exclusive gateway{elementRef} has outgoing flows without conditions. Use set_bpmn_element_properties with conditionExpression on the sequence flows, or mark one as default with isDefault: true',
  'bpmn-mcp/parallel-gateway-merge-exclusive':
    'A parallel gateway is merging mutually exclusive paths{elementRef}. Replace with an exclusive gateway using replace_bpmn_element',
  'camunda-compat/history-time-to-live':
    'Set historyTimeToLive on the process. Use set_bpmn_element_properties on the process element with camunda:historyTimeToLive',
};

/**
 * Generate a fix suggestion for a lint issue based on its rule name.
 * Returns a human-readable suggestion or undefined if no fix is applicable.
 */
function suggestFix(issue: FlatLintIssue, diagramId: string): string | undefined {
  const { rule, elementId } = issue;
  if (!rule) return undefined;

  const template = FIX_SUGGESTIONS[rule];
  if (!template) return undefined;

  const elementRef = elementId ? ` on element "${elementId}"` : '';
  return template.replace(/{elementRef}/g, elementRef).replace(/{diagramId}/g, diagramId);
}

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

  switch (rule) {
    case 'label-required':
    case 'bpmn-mcp/naming-convention':
      if (elementId) {
        return {
          tool: 'set_bpmn_element_properties',
          args: { diagramId, elementId, properties: { name: '<descriptive name>' } },
        };
      }
      return undefined;
    case 'start-event-required':
      return {
        tool: 'add_bpmn_element',
        args: { diagramId, elementType: 'bpmn:StartEvent' },
      };
    case 'end-event-required':
      return {
        tool: 'add_bpmn_element',
        args: { diagramId, elementType: 'bpmn:EndEvent' },
      };
    case 'bpmn-mcp/camunda-topic-without-external-type':
      if (elementId) {
        return {
          tool: 'set_bpmn_element_properties',
          args: { diagramId, elementId, properties: { 'camunda:type': 'external' } },
        };
      }
      return undefined;
    case 'bpmn-mcp/parallel-gateway-merge-exclusive':
      if (elementId) {
        return {
          tool: 'replace_bpmn_element',
          args: { diagramId, elementId, newType: 'bpmn:ExclusiveGateway' },
        };
      }
      return undefined;
    default:
      return undefined;
  }
}

export async function handleValidate(args: ValidateArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { config, lintMinSeverity } = args;
  const diagram = requireDiagram(args.diagramId);

  // Resolve the effective bpmnlint config (user override > .bpmnlintrc > default)
  const effectiveConfig = config ? (config as any) : getEffectiveConfig();

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
