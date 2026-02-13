/**
 * MCP Prompts — reusable modeling workflows and recipes.
 *
 * Provides step-by-step instructions for common BPMN modeling patterns.
 * These prompts guide AI callers through multi-tool workflows, reducing
 * improvisation and ensuring correct BPMN semantics.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { type PromptDefinition, ADDITIONAL_PROMPTS } from './prompt-definitions';

const PROMPTS: PromptDefinition[] = [
  {
    name: 'create-executable-process',
    title: 'Create executable Operaton / Camunda 7 process',
    description:
      'Step-by-step guide to create a complete executable BPMN process for Operaton / Camunda 7: ' +
      'diagram creation, start event, user/service tasks with forms and external topics, ' +
      'gateways with conditions, and end event.',
    arguments: [
      {
        name: 'processName',
        description: 'Name for the process (e.g. "Order Processing")',
        required: true,
      },
      {
        name: 'description',
        description:
          'Brief description of what the process should do (e.g. "Handle incoming orders with approval")',
        required: false,
      },
    ],
    getMessages: (args) => {
      const name = args.processName || 'My Process';
      const desc = args.description ? `\n\nProcess description: ${args.description}` : '';
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Create an executable Operaton / Camunda 7 BPMN process called "${name}".${desc}\n\n` +
              `Follow these steps:\n\n` +
              `1. **Create diagram**: Use \`create_bpmn_diagram\` with name "${name}"\n` +
              `2. **Add start event**: Use \`add_bpmn_element\` with elementType "bpmn:StartEvent"\n` +
              `3. **Model the happy path**: Add tasks (UserTask for human work, ServiceTask for ` +
              `system integration) connected in sequence. Name every element with verb-object ` +
              `pattern (e.g. "Review Order", "Send Confirmation").\n` +
              `4. **Add decision points**: Use ExclusiveGateway for decisions. Name with a question ` +
              `(e.g. "Order valid?"). Set conditions on outgoing flows and mark one as default.\n` +
              `5. **Add end event**: Use \`add_bpmn_element\` with elementType "bpmn:EndEvent"\n` +
              `6. **Configure tasks**:\n` +
              `   - UserTasks: Set \`camunda:assignee\` or \`camunda:candidateGroups\`, add form fields ` +
              `with \`set_bpmn_form_data\`\n` +
              `   - ServiceTasks: Set \`camunda:type\` to "external" and \`camunda:topic\` for ` +
              `external task workers\n` +
              `7. **Add exception handling**: Add boundary timer/error events where appropriate\n` +
              `8. **Layout**: Run \`layout_bpmn_diagram\` for clean arrangement\n` +
              `9. **Validate**: Run \`validate_bpmn_diagram\` and fix any issues\n` +
              `10. **Export**: Use \`export_bpmn\` to get the final BPMN XML`,
          },
        },
      ];
    },
  },
  {
    name: 'convert-to-collaboration',
    title: 'Convert process to collaboration',
    description:
      'Step-by-step guide to convert a single-pool BPMN process into a collaboration diagram ' +
      'with multiple participants. Follows the Operaton / Camunda 7 pattern: one executable pool + ' +
      'collapsed partner pools for external systems.',
    arguments: [
      {
        name: 'diagramId',
        description: 'The ID of the existing diagram to convert',
        required: true,
      },
      {
        name: 'partners',
        description:
          'Comma-separated list of external partners/systems (e.g. "Customer, Payment Gateway")',
        required: true,
      },
    ],
    getMessages: (args) => {
      const diagramId = args.diagramId || '<diagramId>';
      const partners = args.partners || 'External System';
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Convert diagram "${diagramId}" into a collaboration with these partners: ${partners}\n\n` +
              `**Important Operaton / Camunda 7 rules:**\n` +
              `- Only ONE pool can be deployed and executed\n` +
              `- Partner pools must be COLLAPSED (thin bars)\n` +
              `- Use message flows between expanded pool elements and collapsed pools\n\n` +
              `Follow these steps:\n\n` +
              `1. **Review current state**: Use \`summarize_bpmn_diagram\` on "${diagramId}" ` +
              `to understand the existing process structure.\n` +
              `2. **Create collaboration**: Use \`create_bpmn_collaboration\` with:\n` +
              `   - First participant: the existing process name (expanded, executable)\n` +
              `   - Additional participants: ${partners} (each with \`collapsed: true\`)\n` +
              `3. **Recreate the process**: Add all elements from the original process into the ` +
              `expanded pool using \`participantId\`. Preserve the original flow structure.\n` +
              `4. **Add message flows**: Use \`connect_bpmn_elements\` to create message flows ` +
              `between elements in the expanded pool and collapsed partner pools. Message flows ` +
              `represent communication between participants.\n` +
              `5. **Layout**: Run \`layout_bpmn_diagram\` to arrange everything cleanly.\n` +
              `6. **Validate**: Run \`validate_bpmn_diagram\` and fix any issues.\n\n` +
              `**Do NOT:**\n` +
              `- Create multiple expanded pools (only one is executable in Operaton / Camunda 7)\n` +
              `- Duplicate flow nodes across pools\n` +
              `- Use sequence flows between pools (use message flows instead)`,
          },
        },
      ];
    },
  },
  {
    name: 'add-sla-timer-pattern',
    title: 'Add SLA timer pattern',
    description:
      'Add an SLA timer to a task or subprocess using either a boundary timer event ' +
      '(interrupting or non-interrupting) or a timer event subprocess. Includes escalation handling.',
    arguments: [
      {
        name: 'diagramId',
        description: 'The diagram ID',
        required: true,
      },
      {
        name: 'targetElementId',
        description: 'The ID of the task or subprocess to add the SLA timer to',
        required: true,
      },
      {
        name: 'duration',
        description: 'ISO 8601 duration for the SLA (e.g. "PT4H" for 4 hours, "P2D" for 2 days)',
        required: true,
      },
      {
        name: 'interrupting',
        description: 'Whether the timer should interrupt the task ("true" or "false")',
        required: false,
      },
    ],
    getMessages: (args) => {
      const diagramId = args.diagramId || '<diagramId>';
      const targetId = args.targetElementId || '<elementId>';
      const duration = args.duration || 'PT4H';
      const interrupting = args.interrupting !== 'false';
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Add an SLA timer to element "${targetId}" in diagram "${diagramId}" ` +
              `with duration ${duration} (${interrupting ? 'interrupting' : 'non-interrupting'}).\n\n` +
              `Follow these steps:\n\n` +
              `1. **Add boundary timer event**: Use \`add_bpmn_element\` with:\n` +
              `   - elementType: "bpmn:BoundaryEvent"\n` +
              `   - hostElementId: "${targetId}"\n` +
              `   - eventDefinitionType: "bpmn:TimerEventDefinition"\n` +
              `   - eventDefinitionProperties: { timeDuration: "${duration}" }\n` +
              `   - name: "SLA exceeded"\n` +
              `   ${!interrupting ? '- Then use set_bpmn_element_properties to set cancelActivity: false for non-interrupting\n' : ''}\n` +
              `2. **Add escalation handling**: After the boundary event, add the escalation path:\n` +
              `   - For simple notification: add a SendTask or ServiceTask ("Notify SLA breach")\n` +
              `   - For escalation: add a UserTask assigned to a manager ("Handle SLA escalation")\n` +
              `3. **Connect and end**: Connect the escalation path to an EndEvent\n` +
              `4. **Layout**: Run \`layout_bpmn_diagram\` to arrange the new elements\n\n` +
              `**When to use non-interrupting:** The main task continues even after the SLA is breached ` +
              `(e.g., send a reminder but let the user finish). Use interrupting when the task should ` +
              `be cancelled on SLA breach.`,
          },
        },
      ];
    },
  },
  {
    name: 'add-approval-pattern',
    title: 'Add approval with default flow and conditions',
    description:
      'Add an approval pattern with a user task, exclusive gateway, and conditional flows. ' +
      'Includes proper default flow, condition expressions, and form fields.',
    arguments: [
      {
        name: 'diagramId',
        description: 'The diagram ID',
        required: true,
      },
      {
        name: 'afterElementId',
        description: 'The ID of the element after which to add the approval pattern',
        required: true,
      },
      {
        name: 'approverGroup',
        description: 'The candidate group for the approval task (e.g. "managers")',
        required: false,
      },
    ],
    getMessages: (args) => {
      const diagramId = args.diagramId || '<diagramId>';
      const afterId = args.afterElementId || '<afterElementId>';
      const group = args.approverGroup || 'approvers';
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Add an approval pattern after element "${afterId}" in diagram "${diagramId}".\n\n` +
              `Follow these steps:\n\n` +
              `1. **Add approval user task**: Use \`add_bpmn_element\` with:\n` +
              `   - elementType: "bpmn:UserTask"\n` +
              `   - name: "Review and Approve"\n` +
              `   - afterElementId: "${afterId}"\n` +
              `2. **Configure the task**:\n` +
              `   - Set \`camunda:candidateGroups\` to "${group}"\n` +
              `   - Add form fields with \`set_bpmn_form_data\`:\n` +
              `     - "approved" (boolean): "Approved?"\n` +
              `     - "comment" (string): "Comments"\n` +
              `3. **Add gateway**: Use \`add_bpmn_element\` with:\n` +
              `   - elementType: "bpmn:ExclusiveGateway"\n` +
              `   - name: "Approved?"\n` +
              `   - afterElementId: the approval task ID\n` +
              `4. **Add approved path**: Connect the gateway to the next step in the happy path ` +
              `with conditionExpression: '\${approved == true}' and label: "Yes"\n` +
              `5. **Add rejected path**: Add a new branch from the gateway with:\n` +
              `   - conditionExpression: '\${approved == false}'\n` +
              `   - label: "No"\n` +
              `   - Connect to a rejection handling task or end event\n` +
              `6. **Set default flow**: Use \`connect_bpmn_elements\` with isDefault: true for ` +
              `the approved path (or whichever should be the fallback)\n` +
              `7. **Layout**: Run \`layout_bpmn_diagram\` to arrange the pattern\n\n` +
              `**Best practices:**\n` +
              `- Always set conditions on outgoing gateway flows\n` +
              `- Always mark one flow as the default (taken when no condition matches)\n` +
              `- Name the gateway as a question ("Approved?")\n` +
              `- Label outgoing flows as answers ("Yes", "No")`,
          },
        },
      ];
    },
  },
  ...ADDITIONAL_PROMPTS,
];

/** List all available prompts. */
export function listPrompts(): Array<{
  name: string;
  title: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}> {
  return PROMPTS.map((p) => ({
    name: p.name,
    title: p.title,
    description: p.description,
    arguments: p.arguments,
  }));
}

/** Get a specific prompt by name, with argument substitution. */
export function getPrompt(
  name: string,
  args: Record<string, string> = {}
): {
  description: string;
  messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
} {
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) {
    throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
  }
  return {
    description: prompt.description,
    messages: prompt.getMessages(args),
  };
}
