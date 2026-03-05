/**
 * Prompt definitions for MCP prompts.
 *
 * Three modeling-style prompts that toggle how the agent builds diagrams.
 * Each prompt instructs the agent on proper MCP tool usage and reminds
 * it to export the final diagram using export_bpmn with a filePath.
 */

/** Reusable interface for prompt definitions. */
export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  getMessages: (
    args: Record<string, string>
  ) => Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
}

// ── Additional prompts ─────────────────────────────────────────────────────

const CREATE_EXECUTABLE_PROCESS_INSTRUCTIONS = `When building an executable Camunda 7 / Operaton process (no pool), follow these rules:

**Task configuration:**
- Service tasks: set camunda:type="external" and camunda:topic via set_bpmn_element_properties.
- User tasks: set camunda:assignee or camunda:candidateGroups.
- Use set_bpmn_event_definition for all timer, error, and message events.

**Gateway rules:**
- All exclusive gateways must have a default flow: use connect_bpmn_elements with isDefault: true.
- All non-default branches must have a conditionExpression.

**Retry / loop-back flows (CRITICAL):**
When a flow loops back to a task that already has an incoming flow (e.g. a retry path rejoining "Charge Payment"),
you MUST insert an explicit merge gateway first.
1. Use add_bpmn_element with flowId set to the existing incoming flow ID to insert an ExclusiveGateway inline.
2. Then connect the retry flow to the new gateway with connect_bpmn_elements.
Never connect two flows directly into a non-gateway task — this creates an implicit merge that
causes multiple token activations at runtime and will block the export lint gate.

**Final steps:**
- Run validate_bpmn_diagram before export to catch errors.
- Export with export_bpmn using format: "both" and a filePath.`;

/** Additional prompts defined in this module. */
export const ADDITIONAL_PROMPTS: PromptDefinition[] = [
  {
    name: 'create-executable-process',
    title: 'Create Executable Process (Camunda 7 / Operaton)',
    description:
      'Guide for building an executable BPMN process for Camunda 7 / Operaton without pools. ' +
      'Enforces gateway rules, task configuration, and the merge-gateway requirement for retry loops.',
    arguments: [
      {
        name: 'processName',
        description: 'Name of the business process to model',
        required: true,
      },
      {
        name: 'description',
        description: 'Brief description of the process flow',
        required: false,
      },
    ],
    getMessages: (args) => [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Create an executable Camunda 7 / Operaton BPMN process named "${args.processName ?? 'My Process'}"` +
            (args.description ? `\n\nProcess description: ${args.description}` : '') +
            `\n\n${CREATE_EXECUTABLE_PROCESS_INSTRUCTIONS}`,
        },
      },
    ],
  },
];
